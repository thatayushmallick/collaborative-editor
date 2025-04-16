const express = require('express');
const cors = require('cors');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const Y = require('yjs');
const { setupWSConnection } = require('y-websocket');
const bcrypt = require('bcrypt');

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

// Mock user database with hashed passwords
const users = [
  { id: 1, username: 'user1', password: bcrypt.hashSync('pass1', 10) },
  { id: 2, username: 'user2', password: bcrypt.hashSync('pass2', 10) },
];

// Configure Passport with Local Strategy
passport.use(new LocalStrategy(
  (username, password, done) => {
    console.log('Authenticating user:', username);
    const user = users.find(u => u.username === username);
    if (!user) return done(null, false, { message: 'Incorrect username.' });
    if (!bcrypt.compareSync(password, user.password)) return done(null, false, { message: 'Incorrect password.' });
    return done(null, user);
  }
));

// Test endpoint
app.get('/test', (req, res) => {
  console.log('Test endpoint hit');
  res.send('Server is running');
});

// Login endpoint to issue JWT token
app.post('/login', passport.authenticate('local', { session: false }), (req, res) => {
  console.log('Login request received:', req.body);
  const token = jwt.sign({ id: req.user.id }, 'secret_key', { expiresIn: '1h' });
  res.json({ token });
});

// Create WebSocket server
const wss = new WebSocket.Server({ port: 1235 });

// Handle WebSocket connections with JWT verification
wss.on('connection', (ws, req) => {
  console.log('WebSocket connection attempt');
  const urlParams = new URLSearchParams(req.url.slice(1));
  const token = urlParams.get('token');
  if (!token) {
    console.log('WebSocket closed: No token');
    ws.close(1008, 'Authentication required');
    return;
  }
  try {
    jwt.verify(token, 'secret_key');
    console.log('WebSocket connection established');
    setupWSConnection(ws, req);
  } catch (err) {
    console.log('WebSocket closed: Invalid token', err);
    ws.close(1008, 'Invalid token');
  }
});

wss.on('error', (err) => {
  console.error('WebSocket server error:', err);
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server on port 1234
app.listen(1234, () => {
  console.log('Server running on http://localhost:1234');
});