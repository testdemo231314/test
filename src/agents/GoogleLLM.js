const { GoogleGenAI } = require('@google/genai');
const Agent = require('./Agent');

class GoogleLLMAgent extends Agent {
  constructor(id, name, prompt, io, apiKey, dataManager = null, cronManager = null, agentManager = null, model = 'gemini-3.8-flash') {
    super(id, name, prompt, io, dataManager, cronManager, agentManager, model);
    this.apiKey = apiKey;
    this.client = null;
    this.currentInteractionId = null;
    this.currentStepId = null;
    this.currentFunctionName = null;
    this.accumulatedArgs = '';
    this.isProcessing = false;
    
    // Initialize client
    this._initializeClient();
  }

  _initializeClient() {
    try {
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
      console.log(`GoogleLLM Agent ${this.id} client initialized`);
    } catch (error) {
      console.error(`GoogleLLM Agent ${this.id} client initialization error:`, error);
      this.client = null;
    }
  }

  _buildSystemInstruction() {
    let instruction = this.prompt;

    // Konuşma geçmişini ekle (son 10 mesaj)
    if (this.history && this.history.length > 0) {
      const recentHistory = this.history.slice(-10);
      instruction += '\n\nÖnceki konuşma geçmişi:\n';
      recentHistory.forEach(msg => {
        if (msg.toolUsage) {
          // Tool usage mesajlarını daha uygun formatta göster
          if (msg.toolUsage.type === 'usage') {
            instruction += `${msg.role}: Tool çağrısı (${msg.toolUsage.tool})\n`;
          } else if (msg.toolUsage.type === 'result') {
            instruction += `${msg.role}: Tool sonucu (${msg.toolUsage.tool}): ${JSON.stringify(msg.toolUsage.result)}\n`;
          } else if (msg.toolUsage.type === 'error') {
            instruction += `${msg.role}: Tool hatası (${msg.toolUsage.tool}): ${msg.toolUsage.error}\n`;
          }
        } else {
          instruction += `${msg.role}: ${msg.content}\n`;
        }
      });
    }

    return instruction;
  }

  updateApiKey(newApiKey) {
    this.apiKey = newApiKey;
    this._initializeClient();
    console.log(`GoogleLLM Agent ${this.id} API key updated`);
  }

  async start() {
    await super.start();
    if (!this.client) {
      this._initializeClient();
    }
  }

  stop() {
    super.stop();
    this.currentInteractionId = null;
    this.currentStepId = null;
    this.currentFunctionName = null;
    this.accumulatedArgs = '';
    this.isProcessing = false;
  }

  _createToolDefinition(toolName, toolConfig) {
    return {
      type: "function",
      name: toolName,
      description: toolConfig.description || toolName,
      parameters: {
        type: "object",
        properties: toolConfig.parameters || {},
        required: toolConfig.required || []
      }
    };
  }

  _convertToolsToGoogleFormat(tools) {
    const googleTools = [];
    
    console.log(`GoogleLLM Agent ${this.id} converting ${tools.length} tools to Google format`);
    console.log(`Available tools:`, tools);
    console.log(`Available plugins:`, Array.from(this.toolManager.pluginManager.plugins.keys()));
    
    // Eğer tools null veya undefined ise boş array döndür
    if (!tools || tools.length === 0) {
      console.log(`No tools to convert, returning empty array`);
      return [];
    }
    
    tools.forEach(toolName => {
      console.log(`Processing tool: ${toolName}`);
      
      // Eğer tool plugin.tool formatında ise
      if (toolName && toolName.includes('.')) {
        const [pluginName, actualToolName] = toolName.split('.');
        console.log(`  Tool is in plugin.tool format: ${pluginName}.${actualToolName}`);
        
        const plugin = this.toolManager.pluginManager.plugins.get(pluginName);
        if (plugin && plugin.tools[actualToolName]) {
          const tool = plugin.tools[actualToolName];
          console.log(`  Found tool in plugin:`, tool);
          
          // Plugin tool yapıları zaten doğru formatta
          const googleTool = {
            type: "function",
            name: toolName,
            description: tool.description || toolName,
            parameters: {
              type: "object",
              properties: tool.parameters?.properties || {},
              required: tool.parameters?.required || []
            }
          };
          googleTools.push(googleTool);
          console.log(`  Added Google tool:`, googleTool);
        } else {
          console.log(`  Tool not found in plugin ${pluginName}`);
        }
      } else if (toolName) {
        // Basit tool ismi - plugin içinde ara
        console.log(`  Tool is simple name, searching in plugins...`);
        let found = false;
        for (const [pluginName, plugin] of this.toolManager.pluginManager.plugins.entries()) {
          if (plugin.tools[toolName]) {
            const tool = plugin.tools[toolName];
            console.log(`  Found tool in plugin ${pluginName}:`, tool);
            
            // Google için tool ismini plugin.tool formatında kullanıyoruz
            const fullToolName = `${pluginName}.${toolName}`;
            const googleTool = {
              type: "function",
              name: fullToolName, // Plugin.tool formatında kullan
              description: tool.description || toolName,
              parameters: {
                type: "object",
                properties: tool.parameters?.properties || {},
                required: tool.parameters?.required || []
              }
            };
            googleTools.push(googleTool);
            console.log(`  Added Google tool with full name: ${fullToolName}`, googleTool);
            found = true;
            break;
          }
        }
        
        // Bulunamazsa basit definition
        if (!found) {
          console.log(`  Tool not found in any plugin, creating basic definition`);
          googleTools.push({
            type: "function",
            name: toolName,
            description: toolName,
            parameters: {
              type: "object",
              properties: {},
              required: []
            }
          });
        }
      } else {
        console.log(`  Tool name is null or undefined, skipping`);
      }
    });
    
    console.log(`Final Google tools:`, googleTools);
    return googleTools;
  }

  async _executeModelMessage(content, options = {}) {
    if (!this.client) {
      console.error(`GoogleLLM Agent ${this.id} client not initialized`);
      this.completeCurrentQueueItem();
      return;
    }

    this.isProcessing = true;
    this.status = 'Gorev_yapiyor';
    this.io.emit('agent-status', {
      agentId: this.id,
      status: 'Gorev_yapiyor'
    });

    try {
      // Initialize streaming buffer for new response
      this.currentResponseBuffer = '';
      this.isStreamingResponse = true;
      this.currentResponseStartTime = new Date().toISOString();
      
      // Convert enabled tools to Google format
      // enabledTools null ise tüm araçları al
      const toolsToConvert = this.enabledTools || this.toolManager.getAvailableTools();
      console.log(`GoogleLLM Agent ${this.id} enabledTools:`, this.enabledTools);
      console.log(`GoogleLLM Agent ${this.id} toolsToConvert:`, toolsToConvert);
      
      const googleTools = this._convertToolsToGoogleFormat(toolsToConvert);
      
      // Build system instruction with history
      const systemInstruction = this._buildSystemInstruction();
      
      // Create input with system instruction (GoogleLLM formatında)
      let inputContent = content;
      if (systemInstruction && systemInstruction !== this.prompt) {
        // Sadece system instruction farklıysa ekle
        inputContent = `${systemInstruction}\n\nUser: ${content}`;
      }
      
      // Create initial interaction with streaming
      const stream = await this.client.interactions.create({
        model: this.model,
        tools: googleTools.length > 0 ? googleTools : undefined,
        input: inputContent,
        stream: true,
      });

      let fullResponse = '';
      let firstInteractionId = null;
      let funcCallId = null;
      let funcCallName = null;
      let funcArgsAccumulated = '';
      let functionCall = null;

      // Process first interaction
      for await (const event of stream) {
        if (event.event_type === "interaction.created") {
          firstInteractionId = event.interaction.id;
          this.currentInteractionId = firstInteractionId;
        } else if (event.event_type === "step.start") {
          const step = event.step;
          if (step.type === "function_call") {
            funcCallId = step.id;
            funcCallName = step.name;
            this.currentStepId = funcCallId;
            this.currentFunctionName = funcCallName;
          }
        } else if (event.event_type === "step.delta") {
          if (event.delta.type === "arguments_delta") {
            funcArgsAccumulated += event.delta.arguments;
            this.accumulatedArgs = funcArgsAccumulated;
          } else if (event.delta.type === "text") {
            fullResponse += event.delta.text;
            
            // Add chunk to streaming buffer
            this.currentResponseBuffer += event.delta.text;
            
            // Stream text to client for real-time display (GoogleAgent.js formatında)
            this.io.emit('agent-stream', {
              agentId: this.id,
              chunk: event.delta.text,
              timestamp: this.currentResponseStartTime
            });
            
            // Save to storage after each chunk
            if (this.dataManager) {
              this.dataManager.saveAgent(this);
            }
          }
        }
      }

      // If function call was made, execute it and continue
      if (funcCallId && firstInteractionId && funcCallName) {
        console.log(`GoogleLLM Agent ${this.id} executing function: ${funcCallName}`);
        
        // Tool kullanımını history'ye kaydet (GoogleLive formatında)
        const toolUsageMessage = {
          role: 'assistant',
          content: '',
          timestamp: new Date().toISOString(),
          toolUsage: {
            tool: funcCallName,
            args: funcArgsAccumulated,
            type: 'usage'
          }
        };
        this.history.push(toolUsageMessage);
        
        // Sort history to maintain correct order
        this.sortHistoryByTimestamp();
        
        // Apply memory limit
        this.applyMemoryLimit();
        
        // Save to storage after tool usage
        if (this.dataManager) {
          this.dataManager.saveAgent(this);
        }
        
        this.io.emit('agent-tool-usage', {
          agentId: this.id,
          toolUsage: {
            tool: funcCallName,
            args: funcArgsAccumulated,
            timestamp: new Date().toISOString()
          }
        });

        try {
          // Parse arguments
          let parsedArgs = {};
          try {
            // Eğer funcArgsAccumulated boş ise boş obje kullan
            if (funcArgsAccumulated && funcArgsAccumulated.trim()) {
              parsedArgs = JSON.parse(funcArgsAccumulated);
            } else {
              parsedArgs = {};
            }
          } catch (e) {
            // Parse hatası durumunda boş obje kullan
            parsedArgs = {};
          }

          console.log(`GoogleLLM Agent ${this.id} executing tool: ${funcCallName} with args:`, parsedArgs);

          // Auto-add senderAgentId for sendMessageToAgent (GoogleLive formatında)
          if ((funcCallName === 'sendMessageToAgent' || funcCallName === 'agent.sendMessageToAgent') && !parsedArgs.senderAgentId) {
            parsedArgs = { ...parsedArgs, senderAgentId: this.id };
            console.log(`Auto-added senderAgentId: ${this.id} for sendMessageToAgent`);
          }

          // Execute tool - handle both plugin.tool and simple tool names
          let toolResult;
          try {
            // GoogleLLM'den gelen tool name plugin.tool formatında olabilir
            // Bu yüzden önce simple tool name'i bulmaya çalışalım
            let toolToExecute = funcCallName;
            
            // Eğer funcCallName plugin.tool formatında ise, ToolManager'ın executeTool fonksiyonu zaten bunu handle eder
            // Ancak bazı durumlarda simple name gerekli olabilir
            if (funcCallName.includes('.')) {
              console.log(`Tool name is in plugin.tool format, trying direct execution`);
            } else {
              console.log(`Tool name is simple format, searching for full name`);
              // Simple name'i full name'e çevir
              const allTools = this.toolManager.pluginManager.getAllTools();
              for (const [fullName, toolConfig] of Object.entries(allTools)) {
                if (fullName.endsWith(`.${funcCallName}`)) {
                  toolToExecute = fullName;
                  console.log(`Found full tool name: ${fullName}`);
                  break;
                }
              }
            }
            
            console.log(`Executing tool: ${toolToExecute}`);
            toolResult = await this.toolManager.executeTool(toolToExecute, parsedArgs);
            console.log(`Tool execution result:`, toolResult);
            
            // Tool sonucunu history'ye kaydet (GoogleLive formatında)
            const toolResultMessage = {
              role: 'assistant',
              content: '',
              timestamp: new Date().toISOString(),
              toolUsage: {
                tool: funcCallName,
                args: parsedArgs,
                result: toolResult,
                type: 'result'
              }
            };
            this.history.push(toolResultMessage);
            
            // Sort history to maintain correct order
            this.sortHistoryByTimestamp();
            
            // Apply memory limit
            this.applyMemoryLimit();
            
            // Save to storage after tool execution
            if (this.dataManager) {
              this.dataManager.saveAgent(this);
            }
            
          } catch (toolError) {
            console.error(`GoogleLLM Agent ${this.id} tool execution error:`, toolError);
            
            // Tool hatasını history'ye kaydet (GoogleLive formatında)
            const toolErrorMessage = {
              role: 'assistant',
              content: '',
              timestamp: new Date().toISOString(),
              toolUsage: {
                tool: funcCallName,
                args: parsedArgs,
                error: toolError.message,
                type: 'error'
              }
            };
            this.history.push(toolErrorMessage);
            
            // Sort history to maintain correct order
            this.sortHistoryByTimestamp();
            
            // Apply memory limit
            this.applyMemoryLimit();
            
            // Save to storage after tool error
            if (this.dataManager) {
              this.dataManager.saveAgent(this);
            }
            
            throw toolError;
          }
          
          this.io.emit('agent-tool-result', {
            agentId: this.id,
            toolUsage: {
              tool: funcCallName,
              result: toolResult,
              timestamp: new Date().toISOString()
            }
          });

          // Send result back to continue the conversation
          const dummyResult = {
            content: [{ 
              type: "text", 
              text: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
            }]
          };

          const stream2 = await this.client.interactions.create({
            model: this.model,
            previous_interaction_id: firstInteractionId,
            input: [{
              type: "function_result",
              name: funcCallName,
              call_id: funcCallId,
              result: dummyResult
            }],
            stream: true,
          });

          // Process second interaction
          for await (const event of stream2) {
            if (event.event_type === "step.delta") {
              if (event.delta.type === "text") {
                fullResponse += event.delta.text;
                
                // Add chunk to streaming buffer
                this.currentResponseBuffer += event.delta.text;
                
                // Stream text to client for real-time display (GoogleAgent.js formatında)
                this.io.emit('agent-stream', {
                  agentId: this.id,
                  chunk: event.delta.text,
                  timestamp: this.currentResponseStartTime
                });
                
                // Save to storage after each chunk
                if (this.dataManager) {
                  this.dataManager.saveAgent(this);
                }
              }
            }
          }
        } catch (toolError) {
          console.error(`GoogleLLM Agent ${this.id} tool execution error:`, toolError);
          
          // Send error result back
          const errorResult = {
            content: [{ 
              type: "text", 
              text: JSON.stringify({ error: toolError.message })
            }]
          };

          try {
            const stream2 = await this.client.interactions.create({
              model: this.model,
              previous_interaction_id: firstInteractionId,
              input: [{
                type: "function_result",
                name: funcCallName,
                call_id: funcCallId,
                result: errorResult
              }],
              stream: true,
            });

            for await (const event of stream2) {
              if (event.event_type === "step.delta") {
                if (event.delta.type === "text") {
                  fullResponse += event.delta.text;
                  
                  // Add chunk to streaming buffer
                  this.currentResponseBuffer += event.delta.text;
                  
                  // Stream text to client for real-time display (GoogleAgent.js formatında)
                  this.io.emit('agent-stream', {
                    agentId: this.id,
                    chunk: event.delta.text,
                    timestamp: this.currentResponseStartTime
                  });
                  
                  // Save to storage after each chunk
                  if (this.dataManager) {
                    this.dataManager.saveAgent(this);
                  }
                }
              }
            }
          } catch (retryError) {
            console.error(`GoogleLLM Agent ${this.id} retry error:`, retryError);
          }
        }
      }

      // Add assistant response to history (GoogleLive formatında - parça parça)
      if (fullResponse) {
        // Önce son mesajın tool usage olup olmadığını kontrol et
        const lastMessage = this.history[this.history.length - 1];
        const isLastToolMessage = lastMessage && lastMessage.toolUsage;
        
        if (isLastToolMessage) {
          // Son mesaj tool usage ise, yeni assistant mesajı ekle
          this.history.push({
            role: 'assistant',
            content: fullResponse,
            timestamp: new Date().toISOString()
          });
        } else if (lastMessage && lastMessage.role === 'assistant') {
          // Mevcut assistant mesajını güncelle (streaming)
          lastMessage.content = fullResponse;
          lastMessage.timestamp = new Date().toISOString();
        } else {
          // Yeni assistant mesajı ekle
          this.history.push({
            role: 'assistant',
            content: fullResponse,
            timestamp: new Date().toISOString()
          });
        }

        // Sort history by timestamp to ensure correct order
        this.sortHistoryByTimestamp();

        // Reset streaming buffer
        this.isStreamingResponse = false;
        this.currentResponseBuffer = '';
        this.currentResponseStartTime = null;

        // Final save to storage
        if (this.dataManager) {
          this.dataManager.saveAgent(this);
        }
        
        // agent-message gönderme - sadece agent-stream kullan
        // Frontend zaten stream event'ini işliyor ve birleştiriyor
      }

    } catch (error) {
      console.error(`GoogleLLM Agent ${this.id} execution error:`, error);
      this.io.emit('agent-error', {
        agentId: this.id,
        error: error.message
      });
    } finally {
      this.isProcessing = false;
      this.status = 'Hazir';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'Hazir'
      });
      
      this.currentInteractionId = null;
      this.currentStepId = null;
      this.currentFunctionName = null;
      this.accumulatedArgs = '';
      
      this.completeCurrentQueueItem();
    }
  }

  _stopModelSession() {
    // GoogleLLM doesn't have persistent sessions like Live API
    // Just reset the state
    this.currentInteractionId = null;
    this.currentStepId = null;
    this.currentFunctionName = null;
    this.accumulatedArgs = '';
    this.isProcessing = false;
  }

  _updateModelSession(model) {
    // Model update handling
    this.model = model;
    console.log(`GoogleLLM Agent ${this.id} model updated to: ${model}`);
  }
}

module.exports = GoogleLLMAgent;