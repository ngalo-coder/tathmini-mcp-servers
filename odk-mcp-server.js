// Updated odk-mcp-server.js with debugging and correct ODK Central API format

const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Environment variables
const ODK_BASE_URL = process.env.ODK_BASE_URL; // https://llewellynouya.shop
const ODK_USERNAME = process.env.ODK_USERNAME; // otienodominic@gmail.com
const ODK_PASSWORD = process.env.ODK_PASSWORD; // SandeBarak!
const PORT = process.env.PORT || 3001;

console.log('=== ODK MCP Server Starting ===');
console.log('ODK_BASE_URL:', ODK_BASE_URL);
console.log('ODK_USERNAME:', ODK_USERNAME ? 'SET' : 'NOT SET');
console.log('ODK_PASSWORD:', ODK_PASSWORD ? 'SET' : 'NOT SET');
console.log('PORT:', PORT);

// ODK API helper with correct ODK Central API format
class ODKConnector {
  constructor() {
    this.baseURL = ODK_BASE_URL;
    this.auth = {
      username: ODK_USERNAME,
      password: ODK_PASSWORD
    };
    
    console.log('ODKConnector initialized with baseURL:', this.baseURL);
  }

  async getProjects() {
    try {
      const url = `${this.baseURL}/v1/projects`;
      console.log('Getting projects from:', url);
      
      const response = await axios.get(url, {
        auth: this.auth,
        timeout: 10000
      });
      return response.data;
    } catch (error) {
      console.error('Failed to fetch projects:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      throw new Error(`Failed to fetch projects: ${error.message}`);
    }
  }

  async getForms(projectId) {
    try {
      const url = `${this.baseURL}/v1/projects/${projectId}/forms`;
      console.log('Getting forms from:', url);
      
      const response = await axios.get(url, {
        auth: this.auth,
        timeout: 10000
      });
      return response.data;
    } catch (error) {
      console.error('Failed to fetch forms:', error.message);
      throw new Error(`Failed to fetch forms: ${error.message}`);
    }
  }

  async getSubmissions(projectId, formId, lastSync = null) {
    try {
      // Correct ODK Central API format for submissions
      let url = `${this.baseURL}/v1/projects/${projectId}/forms/${formId}/submissions`;
      
      if (lastSync) {
        url += `?$filter=__system/submissionDate gt ${lastSync}`;
      }
      
      console.log('Getting submissions from:', url);
      console.log('Auth username:', this.auth.username);
      
      const response = await axios.get(url, {
        auth: this.auth,
        timeout: 15000,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      console.log('Submissions response status:', response.status);
      console.log('Submissions count:', response.data.length || 'Unknown');
      
      return response.data;
    } catch (error) {
      console.error('Failed to fetch submissions:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response headers:', error.response.headers);
        console.error('Response data:', error.response.data);
      }
      if (error.code === 'ENOTFOUND') {
        throw new Error(`Cannot reach ODK server at ${this.baseURL}. Please check the URL.`);
      }
      throw new Error(`Failed to fetch submissions: ${error.message}`);
    }
  }

  async getFormSchema(projectId, formId) {
    try {
      const url = `${this.baseURL}/v1/projects/${projectId}/forms/${formId}`;
      console.log('Getting form schema from:', url);
      
      const response = await axios.get(url, {
        auth: this.auth,
        timeout: 10000
      });
      return response.data;
    } catch (error) {
      console.error('Failed to fetch form schema:', error.message);
      throw new Error(`Failed to fetch form schema: ${error.message}`);
    }
  }
}

const odkConnector = new ODKConnector();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'ODK MCP Server',
    timestamp: new Date().toISOString(),
    environment: {
      ODK_BASE_URL: ODK_BASE_URL || 'NOT SET',
      ODK_USERNAME: ODK_USERNAME ? 'SET' : 'NOT SET',
      ODK_PASSWORD: ODK_PASSWORD ? 'SET' : 'NOT SET',
      PORT: PORT
    }
  });
});

// Debug endpoint to test ODK connection
app.get('/debug/odk-connection', async (req, res) => {
  try {
    console.log('=== Testing ODK Connection ===');
    
    // Test basic connectivity
    const testUrl = `${ODK_BASE_URL}/v1/projects`;
    console.log('Testing URL:', testUrl);
    
    const response = await axios.get(testUrl, {
      auth: {
        username: ODK_USERNAME,
        password: ODK_PASSWORD
      },
      timeout: 10000
    });
    
    res.json({
      success: true,
      message: 'ODK connection successful',
      url: testUrl,
      status: response.status,
      projectsCount: response.data.length || 0,
      projects: response.data
    });
  } catch (error) {
    console.error('ODK connection test failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: {
        url: `${ODK_BASE_URL}/v1/projects`,
        username: ODK_USERNAME,
        hasPassword: !!ODK_PASSWORD
      }
    });
  }
});

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
    
    console.log('=== Fetch Submissions Request ===');
    console.log('Project ID:', projectId);
    console.log('Form ID:', formId);
    console.log('Last Sync:', lastSync);
    
    if (!projectId || !formId) {
      return res.status(400).json({ error: 'projectId and formId are required' });
    }

    if (!ODK_BASE_URL || !ODK_USERNAME || !ODK_PASSWORD) {
      return res.status(500).json({ 
        error: 'ODK credentials not configured',
        missing: {
          ODK_BASE_URL: !ODK_BASE_URL,
          ODK_USERNAME: !ODK_USERNAME,
          ODK_PASSWORD: !ODK_PASSWORD
        }
      });
    }

    const submissions = await odkConnector.getSubmissions(projectId, formId, lastSync);
    
    res.json({
      success: true,
      data: submissions,
      timestamp: new Date().toISOString(),
      count: Array.isArray(submissions) ? submissions.length : 0
    });
  } catch (error) {
    console.error('Fetch submissions error:', error.message);
    res.status(500).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/odk-mcp/tools/get_form_schema', async (req, res) => {
  try {
    const { projectId, formId } = req.body;
    
    console.log('=== Get Form Schema Request ===');
    console.log('Project ID:', projectId);
    console.log('Form ID:', formId);
    
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
    console.error('Get form schema error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/odk-mcp/tools/validate_data', async (req, res) => {
  try {
    const { submissions, validationRules } = req.body;
    
    console.log('=== Validate Data Request ===');
    console.log('Submissions count:', submissions?.length || 0);
    
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
    console.error('Validate data error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`ODK MCP Server running on port ${PORT}`);
  console.log('Environment check:');
  console.log('- ODK_BASE_URL:', ODK_BASE_URL || 'NOT SET');
  console.log('- ODK_USERNAME:', ODK_USERNAME ? 'SET' : 'NOT SET');
  console.log('- ODK_PASSWORD:', ODK_PASSWORD ? 'SET' : 'NOT SET');
});