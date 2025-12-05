/**
 * Remote Desktop Pro - Cloud Relay Server
 * Deploy this on Render.com (free) or Fly.io (free)
 * 
 * This acts as a middleman so agents and controllers can find each other
 * across different networks without port forwarding.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 10 * 1024 * 1024, // 10MB for screen frames
  pingTimeout: 60000,
  pingInterval: 25000
});

// Store connected devices
const agents = new Map();      // agentId -> { socket, info, controllerId }
const controllers = new Map(); // odingerId -> { socket, agentIds }
const pairingCodes = new Map(); // 6-digit code -> { odingerId, created }

// Generate 6-digit pairing code
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    agents: agents.size,
    controllers: controllers.size,
    uptime: process.uptime()
  });
});

// API to lookup pairing code (for agents)
app.get('/lookup/:code', (req, res) => {
  const code = req.params.code;
  const pairing = pairingCodes.get(code);
  
  if (pairing) {
    res.json({ found: true, controllerId: pairing.controllerId });
  } else {
    res.json({ found: false });
  }
});

// List agents for a controller
app.get('/agents/:controllerId', (req, res) => {
  const agentList = [];
  agents.forEach((agent, id) => {
    if (agent.controllerId === req.params.controllerId) {
      agentList.push({
        id,
        hostname: agent.info?.hostname,
        username: agent.info?.username,
        platform: agent.info?.platform,
        connected: true
      });
    }
  });
  res.json(agentList);
});

console.log('═'.repeat(50));
console.log('  REMOTE DESKTOP PRO - CLOUD RELAY');
console.log('═'.repeat(50));

io.on('connection', (socket) => {
  console.log(`[CONNECT] ${socket.id}`);
  
  // ============ CONTROLLER EVENTS ============
  
  // Controller registers and gets a pairing code
  socket.on('controller:register', (info) => {
    const controllerId = socket.id;
    const code = generateCode();
    
    controllers.set(controllerId, {
      socket,
      info,
      code,
      agentIds: new Set()
    });
    
    pairingCodes.set(code, {
      controllerId,
      created: Date.now()
    });
    
    console.log(`[CONTROLLER] Registered: ${controllerId}, Code: ${code}`);
    
    socket.emit('controller:registered', { 
      controllerId, 
      code,
      message: 'Share this code with agents to connect'
    });
    
    // Send current agent list
    const agentList = [];
    agents.forEach((agent, id) => {
      if (agent.controllerId === controllerId) {
        agentList.push({
          id,
          hostname: agent.info?.hostname,
          username: agent.info?.username,
          platform: agent.info?.platform
        });
      }
    });
    socket.emit('controller:agent-list', agentList);
  });
  
  // Controller wants to connect to specific agent
  socket.on('controller:connect-agent', (agentId) => {
    const agent = agents.get(agentId);
    if (agent && agent.socket.connected) {
      console.log(`[RELAY] Controller connecting to agent ${agentId}`);
      socket.emit('controller:agent-connected', { agentId });
    } else {
      socket.emit('controller:agent-error', { error: 'Agent not found or offline' });
    }
  });
  
  // ============ AGENT EVENTS ============
  
  // Agent registers with a pairing code
  socket.on('agent:register', (data) => {
    const { code, info } = data;
    const agentId = socket.id;
    
    // Find controller by code
    const pairing = pairingCodes.get(code);
    if (!pairing) {
      socket.emit('agent:error', { error: 'Invalid pairing code' });
      return;
    }
    
    const controller = controllers.get(pairing.controllerId);
    if (!controller) {
      socket.emit('agent:error', { error: 'Controller not found' });
      return;
    }
    
    // Register agent
    agents.set(agentId, {
      socket,
      info,
      controllerId: pairing.controllerId
    });
    
    controller.agentIds.add(agentId);
    
    console.log(`[AGENT] Registered: ${info?.hostname} -> Controller ${pairing.controllerId}`);
    
    socket.emit('agent:registered', { 
      agentId,
      controllerId: pairing.controllerId 
    });
    
    // Notify controller of new agent
    controller.socket.emit('controller:agent-joined', {
      id: agentId,
      hostname: info?.hostname,
      username: info?.username,
      platform: info?.platform,
      screens: info?.screens
    });
  });
  
  // ============ RELAY ALL CONTROL EVENTS ============
  
  // From Controller to Agent
  const controlEvents = [
    'control:start-stream', 'control:stop-stream', 'control:set-quality', 'control:set-monitor',
    'control:mouse', 'control:keyboard', 'control:scroll',
    'control:clipboard-set', 'control:clipboard-get',
    'control:file-list', 'control:file-download', 'control:file-upload',
    'control:system-info', 'control:processes', 'control:kill-process',
    'control:command', 'control:shell', 'control:message',
    'control:secret-stop', 'control:get-agent-status'
  ];
  
  controlEvents.forEach(event => {
    socket.on(event, (data) => {
      const targetAgentId = data?.agentId || data?.targetAgent;
      if (targetAgentId) {
        const agent = agents.get(targetAgentId);
        if (agent && agent.socket.connected) {
          agent.socket.emit(event, data);
        }
      }
    });
  });
  
  // From Agent to Controller
  const agentEvents = [
    'agent:frame', 'agent:clipboard', 'agent:file-list', 'agent:file-download', 
    'agent:file-upload', 'agent:system-info', 'agent:processes', 
    'agent:kill-process', 'agent:shell', 'agent:heartbeat'
  ];
  
  agentEvents.forEach(event => {
    socket.on(event, (data) => {
      const agent = agents.get(socket.id);
      if (agent) {
        const controller = controllers.get(agent.controllerId);
        if (controller && controller.socket.connected) {
          controller.socket.emit(event, { ...data, agentId: socket.id });
        }
      }
    });
  });
  
  // ============ DISCONNECT ============
  
  socket.on('disconnect', () => {
    // Check if it was an agent
    if (agents.has(socket.id)) {
      const agent = agents.get(socket.id);
      const controller = controllers.get(agent.controllerId);
      
      if (controller) {
        controller.agentIds.delete(socket.id);
        controller.socket.emit('controller:agent-left', { agentId: socket.id });
      }
      
      agents.delete(socket.id);
      console.log(`[AGENT] Disconnected: ${socket.id}`);
    }
    
    // Check if it was a controller
    if (controllers.has(socket.id)) {
      const controller = controllers.get(socket.id);
      
      // Notify all agents
      controller.agentIds.forEach(agentId => {
        const agent = agents.get(agentId);
        if (agent) {
          agent.socket.emit('agent:controller-disconnected');
        }
      });
      
      // Remove pairing code
      pairingCodes.forEach((value, key) => {
        if (value.controllerId === socket.id) {
          pairingCodes.delete(key);
        }
      });
      
      controllers.delete(socket.id);
      console.log(`[CONTROLLER] Disconnected: ${socket.id}`);
    }
  });
});

// Clean up old pairing codes every hour
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  pairingCodes.forEach((value, key) => {
    if (value.created < oneHourAgo) {
      pairingCodes.delete(key);
    }
  });
}, 3600000);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`  Relay running on port ${PORT}`);
  console.log('═'.repeat(50));
});
