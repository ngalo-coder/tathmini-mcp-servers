// ===== 2. OpenRouter AI MCP Server =====
// File: ai-mcp-server.js

const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const PORT = process.env.PORT || 3002;

class OpenRouterConnector {
  constructor() {
    this.apiKey = OPENROUTER_API_KEY;
    this.baseURL = OPENROUTER_BASE_URL;
  }

  async generateCompletion(prompt, model = 'anthropic/claude-3-sonnet', maxTokens = 2000) {
    try {
      const response = await axios.post(`${this.baseURL}/chat/completions`, {
        model: model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: maxTokens,
        temperature: 0.7
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data.choices[0].message.content;
    } catch (error) {
      throw new Error(`OpenRouter API error: ${error.message}`);
    }
  }
}

const aiConnector = new OpenRouterConnector();

// SSE endpoint for n8n
app.get('/ai-mcp/sse', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const keepAlive = setInterval(() => {
    res.write('data: {"type": "heartbeat", "timestamp": "' + new Date().toISOString() + '"}\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
  });

  res.write('data: {"type": "connected", "message": "AI MCP Server connected"}\n\n');
});

// Generate analysis plan
app.post('/ai-mcp/tools/generate_analysis_plan', async (req, res) => {
  try {
    const { researchObjectives, dataSummary, variableTypes } = req.body;
    
    const prompt = `
You are a research data analyst. Given the following research context, create a comprehensive analysis plan.

Research Objectives:
${researchObjectives.map(obj => `- ${obj}`).join('\n')}

Data Summary:
- Total responses: ${dataSummary.totalResponses}
- Variables: ${Object.keys(variableTypes).length}
- Variable types: ${JSON.stringify(variableTypes, null, 2)}

Create a detailed analysis plan that includes:
1. Appropriate statistical tests for each objective
2. Recommended visualizations
3. Data preprocessing steps
4. Expected insights and interpretations

Format your response as a structured JSON object with sections for descriptive_stats, statistical_tests, visualizations, and preprocessing_steps.
`;

    const completion = await aiConnector.generateCompletion(prompt);
    
    res.json({
      success: true,
      data: {
        analysis_plan: completion,
        generated_at: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate interpretations
app.post('/ai-mcp/tools/generate_interpretations', async (req, res) => {
  try {
    const { analysisResults, researchContext, objectives } = req.body;
    
    const prompt = `
You are a research interpreter. Given the following analysis results and research context, provide clear, actionable interpretations.

Research Objectives:
${objectives.map(obj => `- ${obj}`).join('\n')}

Analysis Results:
${JSON.stringify(analysisResults, null, 2)}

Research Context:
${researchContext}

Provide interpretations that:
1. Link findings directly to research objectives
2. Explain statistical significance in plain language
3. Identify key insights and patterns
4. Suggest actionable recommendations
5. Highlight any limitations or caveats

Format your response as structured sections: Key Findings, Statistical Insights, Recommendations, and Limitations.
`;

    const completion = await aiConnector.generateCompletion(prompt);
    
    res.json({
      success: true,
      data: {
        interpretations: completion,
        generated_at: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate questionnaire mapping
app.post('/ai-mcp/tools/map_questionnaire', async (req, res) => {
  try {
    const { questionnaire, objectives } = req.body;
    
    const prompt = `
You are a research design expert. Map the following questionnaire questions to research objectives and suggest variable types and analysis approaches.

Research Objectives:
${objectives.map(obj => `- ${obj}`).join('\n')}

Questionnaire Questions:
${JSON.stringify(questionnaire, null, 2)}

For each question, provide:
1. Which research objective(s) it addresses
2. Variable type (categorical, numerical, ordinal, etc.)
3. Suggested analysis methods
4. Data cleaning considerations

Format your response as a JSON object with question mappings.
`;

    const completion = await aiConnector.generateCompletion(prompt);
    
    res.json({
      success: true,
      data: {
        questionnaire_mapping: completion,
        generated_at: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`AI MCP Server running on port ${PORT}`);
});
