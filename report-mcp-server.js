// ===== 3. Report Generation MCP Server =====
// File: report-mcp-server.js

const express = require('express');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3003;

// SSE endpoint for n8n
app.get('/report-mcp/sse', (req, res) => {
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

  res.write('data: {"type": "connected", "message": "Report MCP Server connected"}\n\n');
});

// Generate PDF report
app.post('/report-mcp/tools/generate_pdf_report', async (req, res) => {
  try {
    const { projectTitle, executiveSummary, findings, recommendations, chartData } = req.body;
    
    const doc = new PDFDocument();
    const fileName = `tathmini-report-${Date.now()}.pdf`;
    const filePath = path.join(__dirname, 'reports', fileName);
    
    // Ensure reports directory exists
    if (!fs.existsSync(path.join(__dirname, 'reports'))) {
      fs.mkdirSync(path.join(__dirname, 'reports'), { recursive: true });
    }
    
    doc.pipe(fs.createWriteStream(filePath));
    
    // Title page
    doc.fontSize(24).text(projectTitle, { align: 'center' });
    doc.moveDown();
    doc.fontSize(16).text('TathminiAI Research Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
    
    // Executive Summary
    doc.addPage();
    doc.fontSize(18).text('Executive Summary', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(executiveSummary);
    
    // Key Findings
    doc.addPage();
    doc.fontSize(18).text('Key Findings', { underline: true });
    doc.moveDown();
    
    findings.forEach((finding, index) => {
      doc.fontSize(14).text(`${index + 1}. ${finding.title}`, { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(12).text(finding.description);
      doc.moveDown();
    });
    
    // Recommendations
    doc.addPage();
    doc.fontSize(18).text('Recommendations', { underline: true });
    doc.moveDown();
    
    recommendations.forEach((rec, index) => {
      doc.fontSize(14).text(`${index + 1}. ${rec.title}`, { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(12).text(rec.description);
      doc.moveDown();
    });
    
    doc.end();
    
    // Wait for PDF generation to complete
    doc.on('end', () => {
      res.json({
        success: true,
        data: {
          fileName: fileName,
          filePath: filePath,
          downloadUrl: `/report-mcp/download/${fileName}`
        }
      });
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Download generated report
app.get('/report-mcp/download/:fileName', (req, res) => {
  const fileName = req.params.fileName;
  const filePath = path.join(__dirname, 'reports', fileName);
  
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'Report not found' });
  }
});

// Generate dashboard data
app.post('/report-mcp/tools/generate_dashboard_data', async (req, res) => {
  try {
    const { rawData, objectives } = req.body;
    
    // Process data for dashboard
    const dashboardData = {
      summary: {
        totalResponses: rawData.length,
        completionRate: (rawData.filter(r => r.status === 'complete').length / rawData.length * 100).toFixed(1),
        lastUpdated: new Date().toISOString()
      },
      charts: [],
      keyMetrics: []
    };
    
    // Generate basic charts data
    if (rawData.length > 0) {
      const sampleData = rawData[0];
      Object.keys(sampleData).forEach(key => {
        if (key.startsWith('_')) return; // Skip system fields
        
        const values = rawData.map(r => r[key]).filter(v => v !== null && v !== undefined);
        
        if (values.length > 0) {
          // For categorical data, create frequency distribution
          const frequency = {};
          values.forEach(v => {
            frequency[v] = (frequency[v] || 0) + 1;
          });
          
          dashboardData.charts.push({
            title: key,
            type: 'bar',
            data: Object.keys(frequency).map(k => ({
              label: k,
              value: frequency[k]
            }))
          });
        }
      });
    }
    
    res.json({
      success: true,
      data: dashboardData
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Report MCP Server running on port ${PORT}`);
});
