// ===== 1. ODK Integration MCP Server =====
// File: odk-mcp-server.js

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const app = express();
app.use(cors());
app.use(express.json());

// Environment variables
const ODK_BASE_URL = process.env.ODK_BASE_URL; // Your ODK server URL
const ODK_USERNAME = process.env.ODK_USERNAME;
const ODK_PASSWORD = process.env.ODK_PASSWORD;
const PORT = process.env.PORT || 3001;

// ODK API helper
class ODKConnector {
  constructor() {
    this.baseURL = ODK_BASE_URL;
    this.auth = {
      username: ODK_USERNAME,
      password: ODK_PASSWORD
    };
  }

  async getProjects() {
    try {
      const response = await axios.get(`${this.baseURL}/v1/projects`, {
        auth: this.auth
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch projects: ${error.message}`);
    }
  }

  async getForms(projectId) {
    try {
      const response = await axios.get(`${this.baseURL}/v1/projects/${projectId}/forms`, {
        auth: this.auth
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch forms: ${error.message}`);
    }
  }

  async getSubmissions(projectId, formId, lastSync = null) {
    try {
      let url = `${this.baseURL}/v1/projects/${projectId}/forms/${formId}/submissions`;
      if (lastSync) {
        url += `?$filter=__system/submissionDate gt ${lastSync}`;
      }
      
      const response = await axios.get(url, {
        auth: this.auth
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch submissions: ${error.message}`);
    }
  }

  async getFormSchema(projectId, formId) {
    try {
      const response = await axios.get(`${this.baseURL}/v1/projects/${projectId}/forms/${formId}`, {
        auth: this.auth
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch form schema: ${error.message}`);
    }
  }
}

const odkConnector = new ODKConnector();

// SSE endpoint for n8n
app.get('/odk-mcp/sse', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write('data: {"type": "heartbeat", "timestamp": "' + new Date().toISOString() + '"}\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
  });

  // Send initial connection message
  res.write('data: {"type": "connected", "message": "ODK MCP Server connected"}\n\n');
});

// MCP Tools endpoints
app.post('/odk-mcp/tools/fetch_submissions', async (req, res) => {
  try {
    const { projectId, formId, lastSync } = req.body;
    
    if (!projectId || !formId) {
      return res.status(400).json({ error: 'projectId and formId are required' });
    }

    const submissions = await odkConnector.getSubmissions(projectId, formId, lastSync);
    
    res.json({
      success: true,
      data: submissions,
      timestamp: new Date().toISOString(),
      count: submissions.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/odk-mcp/tools/get_form_schema', async (req, res) => {
  try {
    const { projectId, formId } = req.body;
    
    if (!projectId || !formId) {
      return res.status(400).json({ error: 'projectId and formId are required' });
    }

    const schema = await odkConnector.getFormSchema(projectId, formId);
    
    res.json({
      success: true,
      data: schema,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/odk-mcp/tools/validate_data', async (req, res) => {
  try {
    const { submissions, validationRules } = req.body;
    
    // Basic validation logic
    const validatedData = submissions.map(submission => {
      const issues = [];
      
      // Check for missing required fields
      if (validationRules.requiredFields) {
        validationRules.requiredFields.forEach(field => {
          if (!submission[field] || submission[field] === '') {
            issues.push(`Missing required field: ${field}`);
          }
        });
      }
      
      // Check for data type validation
      if (validationRules.dataTypes) {
        Object.keys(validationRules.dataTypes).forEach(field => {
          const expectedType = validationRules.dataTypes[field];
          const value = submission[field];
          
          if (value !== null && value !== undefined) {
            if (expectedType === 'number' && isNaN(value)) {
              issues.push(`Invalid number format in field: ${field}`);
            }
            if (expectedType === 'date' && isNaN(Date.parse(value))) {
              issues.push(`Invalid date format in field: ${field}`);
            }
          }
        });
      }
      
      return {
        ...submission,
        _validation: {
          isValid: issues.length === 0,
          issues: issues
        }
      };
    });
    
    res.json({
      success: true,
      data: validatedData,
      summary: {
        total: validatedData.length,
        valid: validatedData.filter(s => s._validation.isValid).length,
        invalid: validatedData.filter(s => !s._validation.isValid).length
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`ODK MCP Server running on port ${PORT}`);
});
