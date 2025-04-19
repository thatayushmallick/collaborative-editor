const serverIp = window.location.hostname || 'localhost';
        

const textarea = document.getElementById('editor');
const overlay = document.getElementById('overlay');
const userListItems = document.getElementById('userListItems');

const usernameContainer = document.getElementById('username-container');
const usernameInput = document.getElementById('username-input');
const joinButton = document.getElementById('join-button');
const wrapper = document.getElementById('wrapper');

// Add these variables to your existing variables
let pingChart = null;
let pingHistory = {
  timestamps: [],
  values: []
};


let ws = '';
let clientId = "";
let version = 0;
let suppress = false;
let prev = "";
let cursors = {};
let colors = {};
let pingTimestamps = {};
let pings = {};
let socket;
let username = '';
let baseVersion = 0;  // Track the base version for operations
let operations = [];  // Store operation history
let localOperations = [];  // Track operations initiated by this client

usernameInput.addEventListener('keypress', function(event) {
    if (event.key === 'Enter') {
    // Prevent default action to avoid form submission if inside a form
    event.preventDefault();
    // Trigger click on join button
    document.getElementById('join-button').click();
    }
})
// Join button click handler
joinButton.addEventListener('click', function() {
    clientId = usernameInput.value.trim();
    if (clientId === '') {
        alert('Please enter your name');
        return;
    }
    
    // Connect to WebSocket server
    ws = new WebSocket(`ws://10.200.242.241:8765`);
    ws.onopen = function() {
        // Send init message with the entered username
        ws.send(JSON.stringify({
            type: 'init',
            author: clientId
        }));
    };
    usernameContainer.style.display = 'none';
    wrapper.style.display = 'flex';

    setTimeout(() => {
        initPingChart();
      }, 1000);

    ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "init") {
        usernameContainer.style.display = 'none';
        wrapper.style.display = 'flex';
        
        version = msg.version;
        baseVersion = msg.version;  // Initialize base version
        
        suppress = true;
        textarea.value = msg.doc;
        prev = msg.doc;
        
        cursors = msg.cursors || {};
        colors = msg.colors || {};
        pings = msg.pings || {};
        
        // Store operation history
        operations = msg.operations || [];
        
        renderCursors();
        suppress = false;
    } 
    else if (msg.type === "edit") {
        if (msg.author === clientId) {
            // This is an acknowledgment of our own operation
            // Remove from local operations if needed
            localOperations = localOperations.filter(op => 
                !(op.action === msg.op.action && 
                  op.pos === msg.op.pos && 
                  op.char === msg.op.char)
            );
            
            // Update version
            version = msg.version;
            baseVersion = msg.version;
            return;
        }
        
        const op = msg.op;
        suppress = true;
        
        // Save cursor position before applying changes
        const cursorPosition = saveCursorPosition(textarea);
        
        if (op.action === "insert") {
            // Adjust cursor position if insert happens before cursor
            if (op.pos < cursorPosition.start) {
                cursorPosition.start += op.char.length;
                cursorPosition.end += op.char.length;
            }
            
            textarea.value = textarea.value.slice(0, op.pos) + op.char + textarea.value.slice(op.pos);
        } else if (op.action === "delete") {
            // Adjust cursor position if delete happens before cursor
            if (op.pos < cursorPosition.start) {
                cursorPosition.start = Math.max(0, cursorPosition.start - 1);
                cursorPosition.end = Math.max(0, cursorPosition.end - 1);
            }
            
            textarea.value = textarea.value.slice(0, op.pos) + textarea.value.slice(op.pos + 1);
        }
        
        prev = textarea.value;
        
        // Restore adjusted cursor position
        restoreCursorPosition(textarea, cursorPosition);
        
        // Store operation in history
        operations.push({
            action: op.action,
            pos: op.pos,
            char: op.char,
            author: msg.author,
            version: msg.version,
            baseVersion: msg.baseVersion
        });
        
        // Update version
        version = msg.version;
        baseVersion = msg.version;
        
        suppress = false;
    } 
    else if (msg.type === "cursor") {
        if (msg.author !== clientId) {
            cursors[msg.author] = msg.pos;
            colors[msg.author] = msg.color;
            renderCursors();
        }
    }
    else if (msg.type === "cursor_update") {
        cursors = msg.cursors || {};
        colors = msg.colors || {};
        renderCursors();
    }
    else if (msg.type === "ping") {
        // Respond to ping with timestamp
        ws.send(JSON.stringify({
            type: "pong",
            author: clientId,
            timestamp: msg.timestamp
        }));
    }
    else if (msg.type === "user_update") {
        userListItems.innerHTML = "";
        const pingMap = msg.pings || {};
        const colMap = msg.colors || {};
        msg.users.forEach(user => {
            const li = document.createElement("li");

            const dot = document.createElement("div");
            dot.className = "online-dot";

            const name = document.createElement("span");
            name.textContent = user;
            name.style.color = colMap[user];
            const pingSpan = document.createElement("span");
            pingSpan.className = "ping-value";
            const ping = pingMap[user];
            if (ping !== undefined) {
                pingSpan.textContent = `${ping} ms`;
                if (ping <= 100) {
                    dot.style.backgroundColor = "rgb(0, 223, 0)";
                } else if (ping <= 250) {
                    dot.style.backgroundColor = "rgb(223, 179, 0)";
                } else {
                    dot.style.backgroundColor = "rgb(255, 20, 20)";
                }
            }
            if (user === clientId) {
                updatePingChart(ping);
              }

            li.appendChild(dot);
            li.appendChild(name);
            li.appendChild(pingSpan);
            userListItems.appendChild(li);
        });
    }

    else if (msg.type === "dns_result") {
        const domain = msg.domain;
        let resultsHTML = `<h4>Results for ${domain}</h4>`;
        
        if (msg.error) {
          resultsHTML += `<p style="color: #d9534f;">Error: ${msg.error}</p>`;
        } else {
          // IPv4 Addresses
          if (msg.a_records && msg.a_records.length > 0) {
            resultsHTML += '<p><strong>IPv4 Addresses:</strong></p><ul>';
            msg.a_records.forEach(record => {
              resultsHTML += `<li>${record}</li>`;
            });
            resultsHTML += '</ul>';
          }
          
          // IPv6 Addresses
          if (msg.aaaa_records && msg.aaaa_records.length > 0) {
            resultsHTML += '<p><strong>IPv6 Addresses:</strong></p><ul>';
            msg.aaaa_records.forEach(record => {
              resultsHTML += `<li>${record}</li>`;
            });
            resultsHTML += '</ul>';
          }
          
          // Mail Servers
          if (msg.mx_records && msg.mx_records.length > 0) {
            resultsHTML += '<p><strong>Mail Servers:</strong></p><ul>';
            msg.mx_records.forEach(record => {
              resultsHTML += `<li>${record}</li>`;
            });
            resultsHTML += '</ul>';
          }
          
          // Name Servers
          if (msg.ns_records && msg.ns_records.length > 0) {
            resultsHTML += '<p><strong>Name Servers:</strong></p><ul>';
            msg.ns_records.forEach(record => {
              resultsHTML += `<li>${record}</li>`;
            });
            resultsHTML += '</ul>';
          }
          
          // TXT Records
          if (msg.txt_records && msg.txt_records.length > 0) {
            resultsHTML += '<p><strong>TXT Records:</strong></p><ul>';
            msg.txt_records.forEach(record => {
              resultsHTML += `<li>${record}</li>`;
            });
            resultsHTML += '</ul>';
          }
        }
        
        dnsResults.innerHTML = resultsHTML;
      }
};


});

function getCursorPos() {
    return textarea.selectionStart;
}
function renderCursors() {
    overlay.innerHTML = "";
    const text = textarea.value;
    const textareaRect = textarea.getBoundingClientRect();
    
    for (const [user, pos] of Object.entries(cursors)) {
        if (user === clientId || pos == null) continue;
        
        // Calculate cursor position using getCaretCoordinates
        const coordinates = getCaretCoordinates(textarea, pos);
        
        // Create cursor element
        const cursorWrapper = document.createElement("div");
        cursorWrapper.className = "cursor-marker";
        cursorWrapper.style.left = `${coordinates.left}px`;
        cursorWrapper.style.top = `${coordinates.top}px`;
        cursorWrapper.style.height = `${coordinates.height}px`;
        cursorWrapper.style.backgroundColor = colors[user] || "#000";
        
        // Create user label
        const label = document.createElement("span");
        label.textContent = user;
        label.style.position = "absolute";
        label.style.top = "-18px";
        label.style.left = "0";
        label.style.backgroundColor = colors[user] || "#000";
        label.style.color = "#fff";
        label.style.fontSize = "0.75em";
        label.style.padding = "2px 6px";
        label.style.borderRadius = "4px";
        label.style.whiteSpace = "nowrap";
        
        cursorWrapper.appendChild(label);
        overlay.appendChild(cursorWrapper);
    }
    }
    function getCaretCoordinates(element, position) {
    // Create a mirror div to copy textarea's styles
    const mirror = document.createElement('div');
    const style = window.getComputedStyle(element);
    
    // Copy styles that affect text layout
    mirror.style.cssText = [
        'position: absolute',
        'visibility: hidden',
        'height: auto',
        'width: ' + element.clientWidth + 'px',
        'white-space: pre-wrap',
        'word-wrap: break-word',
        'border-width: ' + style.borderWidth,
        'padding: ' + style.padding,
        'font: ' + style.font,
        'line-height: ' + style.lineHeight,
        'box-sizing: border-box'
    ].join(';');
    
    // Split text at cursor position
    const textBeforeCaret = element.value.substring(0, position);
    const textAfterCaret = element.value.substring(position);
    
    // Create spans for text before and after caret
    const preSpan = document.createElement('span');
    preSpan.textContent = textBeforeCaret;
    
    const caretSpan = document.createElement('span');
    caretSpan.textContent = '|'; // Placeholder character
    caretSpan.id = 'caret-position-marker';
    
    const postSpan = document.createElement('span');
    postSpan.textContent = textAfterCaret;
    
    // Append elements to mirror
    mirror.appendChild(preSpan);
    mirror.appendChild(caretSpan);
    mirror.appendChild(postSpan);
    document.body.appendChild(mirror);
    
    // Get the position of the caret marker
    const caretMarker = document.getElementById('caret-position-marker');
    const markerRect = caretMarker.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();
    
    // Calculate coordinates relative to textarea
    const coordinates = {
        top: markerRect.top - mirrorRect.top,
        left: markerRect.left - mirrorRect.left,
        height: parseFloat(style.lineHeight) || markerRect.height
    };
    
    // Clean up
    document.body.removeChild(mirror);
    
    return coordinates;
    }

function sendCursorUpdate() {
    if (!ws || suppress) return;

    const pos = getCursorPos();
    ws.send(JSON.stringify({
        type: "cursor",
        author: clientId,
        pos: pos
    }));
}

// textarea.addEventListener("input", () => {
//     if (suppress) return;
//     const newText = textarea.value;
//     const diff = findDiff(prev, newText);
//     let start = 0;
//     while (start < prev.length && start < newText.length && prev[start] === newText[start]) {
//         start++;
//     }

//     let endPrev = prev.length - 1;
//     let endNew = newText.length - 1;
//     while (endPrev >= start && endNew >= start && prev[endPrev] === newText[endNew]) {
//         endPrev--;
//         endNew--;
//     }

//     if (endPrev >= start) {
//         ws.send(JSON.stringify({
//             type: "edit",
//             op: { action: "delete", pos: start },
//             author: clientId
//         }));
//     }

//     if (endNew >= start) {
//         const insertedText = newText.slice(start, endNew + 1);
//         for (let i = 0; i < insertedText.length; i++) {
//             ws.send(JSON.stringify({
//                 type: "edit",
//                 op: { 
//                     action: "insert", 
//                     char: insertedText[i], 
//                     pos: start + i 
//                 },
//                 author: clientId
//             }));
//         }
//     }

//     prev = newText;
//     sendCursorUpdate();
// });

// Add this after your existing code

textarea.addEventListener('input', function(e) {
    if (suppress) return;
    
    const newText = textarea.value;
    const diff = findDiff(prev, newText);
    
    if (diff) {
        // Create enhanced operation with version info
        const operation = {
            ...diff,
            baseVersion: baseVersion  // Include base version
        };
        
        // Track this operation locally
        localOperations.push({
            ...operation,
            localVersion: version
        });
        
        // Send to server
        ws.send(JSON.stringify({
            type: 'edit',
            op: operation,
            author: clientId,
            baseVersion: baseVersion
        }));
    }
    
    prev = newText;
});

const domainInput = document.getElementById('domain-input');
const resolveButton = document.getElementById('resolve-button');
const dnsResults = document.getElementById('dns-results');

// Event listener for the resolve button
resolveButton.addEventListener('click', resolveDomain);

// Event listener for Enter key in the domain input
domainInput.addEventListener('keypress', function(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    resolveDomain();
  }
});

// Function to resolve domain
function resolveDomain() {
  const domain = domainInput.value.trim();
  
  if (domain === '') {
    dnsResults.innerHTML = '<p style="color: #d9534f;">Please enter a domain name</p>';
    return;
  }
  
  // Show loading indicator
  dnsResults.innerHTML = '<p>Resolving...</p>';
  
  // Send request to server
  ws.send(JSON.stringify({
    type: 'dns_resolve',
    domain: domain,
    author: clientId
  }));
}


textarea.addEventListener("click", sendCursorUpdate);
textarea.addEventListener("keyup", sendCursorUpdate);

// Initialize the ping chart
function initPingChart() {
    const ctx = document.getElementById('ping-chart').getContext('2d');
    
    pingChart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [{
          label: 'Ping (ms)',
          data: [],
          borderColor: '#582000',
          backgroundColor: 'rgba(88, 32, 0, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'time',
            time: {
              unit: 'second',
              displayFormats: {
                second: 'HH:mm:ss'
              }
            },
            title: {
              display: true,
              text: 'Time'
            }
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Latency (ms)'
            },
          }
        },
        plugins: {
          legend: {
            display: false
          }
        },
        animation: false // Disable animations for better performance
      }
    });
  }
  
  // Update the ping chart with new data
  function updatePingChart(ping) {
    if (!pingChart) return;
    
    const now = Date.now();
    
    // Add new data point
    pingHistory.timestamps.push(now);
    pingHistory.values.push(ping);
    
    // Keep only data from the last 10 seconds
    const tenSecondsAgo = now - 10000;
    while (pingHistory.timestamps.length > 0 && pingHistory.timestamps[0] < tenSecondsAgo) {
      pingHistory.timestamps.shift();
      pingHistory.values.shift();
    }
    
    // Update chart data
    pingChart.data.datasets[0].data = pingHistory.timestamps.map((timestamp, index) => ({
      x: timestamp,
      y: pingHistory.values[index]
    }));
    
    // Update chart
    pingChart.update();
  }

  // Function to save cursor position
function saveCursorPosition(element) {
    return {
      start: element.selectionStart,
      end: element.selectionEnd,
      direction: document.getSelection().direction // 'forward' or 'backward'
    };
  }
  
  // Function to restore cursor position
  function restoreCursorPosition(element, position) {
    if (!position) return;
    
    try {
      element.setSelectionRange(position.start, position.end, position.direction);
    } catch (e) {
      console.error("Error restoring cursor position:", e);
    }
  }
  /**
 * Finds the difference between two strings and returns an operation object
 * @param {string} oldText - The previous text state
 * @param {string} newText - The current text state
 * @returns {object|null} - An operation object with action, position, and character(s), or null if no change
 */
function findDiff(oldText, newText) {
    // If texts are identical, no change occurred
    if (oldText === newText) return null;
    
    // Case 1: Text was added (insertion)
    if (newText.length > oldText.length) {
      // Find the position where the difference starts
      let i = 0;
      while (i < oldText.length && oldText[i] === newText[i]) {
        i++;
      }
      
      // Calculate how many characters were inserted
      const insertedLength = newText.length - oldText.length;
      
      // Extract the inserted characters
      const insertedChars = newText.substring(i, i + insertedLength);
      
      // Return an insert operation
      return {
        action: 'insert',
        pos: i,
        char: insertedChars
      };
    } 
    // Case 2: Text was removed (deletion)
    else if (newText.length < oldText.length) {
      // Find the position where the difference starts
      let i = 0;
      while (i < newText.length && oldText[i] === newText[i]) {
        i++;
      }
      
      // Return a delete operation
      return {
        action: 'delete',
        pos: i
      };
    }
    // Case 3: Same length but different content (replacement)
    else {
      // Find the first position where texts differ
      let startDiff = 0;
      while (startDiff < oldText.length && oldText[startDiff] === newText[startDiff]) {
        startDiff++;
      }
      
      // This is a replacement, which we'll handle as a delete followed by an insert
      // For now, just return the first different character as a delete
      // The next diff will catch the insert
      return {
        action: 'delete',
        pos: startDiff
      };
    }
  }
  