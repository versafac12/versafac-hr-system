// @ts-nocheck
// ============================================================
// VERSAFAC HR SYSTEM - VERSION 3.0
// Owner: versafac12@gmail.com
// ============================================================

const DEFAULT_SPREADSHEET_ID = '1hMg7vet9QPqc34U2Z0dJ_P4pJzRqgzr0GsdMYFKWG54';
const DEFAULT_GOOGLE_DRIVE_FOLDER_ID = '1_Y4FshskANRFvg0tXyTTd3fVpKkWdIKz';

function formatTimestamp() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

async function sendTelegramNotification(env, message) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message })
    });
    return (await response.json()).ok;
  } catch (e) {
    console.error('Telegram error:', e);
    return false;
  }
}

async function sendEmailNotification(env, to, subject, htmlContent) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Versafac HR <onboarding@resend.dev>',
        to: [to],
        subject: subject,
        html: htmlContent
      })
    });
    return response.ok;
  } catch (e) {
    console.error('Email error:', e);
    return false;
  }
}

async function sendEmailToHR(env, staffName, staffEmail, requestType, details) {
  const hrEmail = 'versafac12@gmail.com';
  const subject = '📋 New Request: ' + requestType;
  const html = `<h2>New Request Received</h2>
    <p><strong>Type:</strong> ${requestType}</p>
    <p><strong>Staff Name:</strong> ${staffName}</p>
    <p><strong>Staff Email:</strong> ${staffEmail}</p>
    <p><strong>Details:</strong><br>${details}</p>
    <br>
    <p>Please login to <a href="https://versafac-hr-worker.haziqaimananif.workers.dev/admin">Admin Panel</a> to approve or reject this request.</p>
    <p>Thank you,<br>Versafac HR System</p>`;
  return sendEmailNotification(env, hrEmail, subject, html);
}

async function getGoogleAccessToken(env) {
  const serviceAccountJson = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');
  let serviceAccount;
  try { serviceAccount = JSON.parse(serviceAccountJson); } catch (e) { throw new Error('Invalid JSON'); }
  const { client_email, private_key } = serviceAccount;
  
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  
  const encode = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const encodedHeader = encode(header);
  const encodedPayload = encode(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  
  const pemToCryptoKey = async (pem, usage) => {
    const pemContents = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    return await crypto.subtle.importKey('pkcs8', binaryDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [usage]);
  };
  
  const privateKeyObj = await pemToCryptoKey(private_key, 'sign');
  const signature = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKeyObj, new TextEncoder().encode(signingInput));
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = `${signingInput}.${encodedSignature}`;
  
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  const data = await response.json();
  if (!data.access_token) throw new Error('Failed to get access token');
  return data.access_token;
}

async function uploadToDrive(file, fileName, mimeType, env) {
  const token = await getGoogleAccessToken(env);
  const folderId = env.GOOGLE_DRIVE_FOLDER_ID || DEFAULT_GOOGLE_DRIVE_FOLDER_ID;
  const metadata = { name: fileName, parents: [folderId], mimeType };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file, fileName);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: form
  });
  const data = await res.json();
  if (!data.id) throw new Error('Upload failed');
  await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  });
  return `https://drive.google.com/file/d/${data.id}/view`;
}

async function appendToSheet(range, values, env) {
  const token = await getGoogleAccessToken(env);
  const spreadsheetId = env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
  if (!res.ok) throw new Error('Failed to write to sheet');
}

async function updateSheet(range, values, env) {
  const token = await getGoogleAccessToken(env);
  const spreadsheetId = env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
  if (!res.ok) throw new Error('Failed to update sheet');
}

async function readSheet(range, env) {
  const token = await getGoogleAccessToken(env);
  const spreadsheetId = env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { if (res.status === 404) return []; throw new Error('Failed to read sheet'); }
  const data = await res.json();
  return data.values || [];
}

async function ensureAllSheetsExist(env) {
  const token = await getGoogleAccessToken(env);
  const spreadsheetId = env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  
  const sheets = {
    'Employees': [['Email', 'Full Name', 'Annual Leave Balance (days)']],
    'LeaveRequests': [['Timestamp', 'Request ID', 'Email', 'Full Name', 'Leave Type', 'Half Day', 'Start Date', 'End Date', 'Duration Type', 'Status', 'Remarks']],
    'OvertimeRequests': [['Timestamp', 'Request ID', 'Email', 'Full Name', 'Start DateTime', 'Hours', 'Rate (RM/hour)', 'Amount (RM)', 'Description', 'Status', 'Remarks']],
    'Claims_Hotel': [['Timestamp', 'Request ID', 'Email', 'Full Name', 'Claim Date', 'Check-in', 'Check-out', 'Nights', 'Amount (RM)', 'Status', 'Remarks']],
    'Claims_Distance': [['Timestamp', 'Request ID', 'Email', 'Full Name', 'Claim Date', 'From', 'To', 'Distance (km)', 'Rate (RM/km)', 'Amount (RM)', 'Status', 'Remarks']],
    'Claims_Meal': [['Timestamp', 'Request ID', 'Email', 'Full Name', 'Claim Date', 'Description', 'Amount (RM)', 'Status', 'Remarks']],
    'Claims_TNG': [['Timestamp', 'Request ID', 'Email', 'Full Name', 'Claim Date', 'Description', 'Amount (RM)', 'Status', 'Remarks']],
    'Claims_Item': [['Timestamp', 'Request ID', 'Email', 'Full Name', 'Claim Date', 'Item Description', 'Amount (RM)', 'Status', 'Remarks']],
    'Receipts': [['Timestamp', 'Email', 'Full Name', 'Receipt Type', 'File URL', 'Description', 'Status']],
    'Settings': [['Setting Key', 'Value']]
  };
  
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  const existingSheets = data.sheets?.map(s => s.properties.title) || [];
  
  for (const [sheetName, headers] of Object.entries(sheets)) {
    if (!existingSheets.includes(sheetName)) {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] })
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1:Z1:append?valueInputOption=RAW`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: headers })
      });
    }
  }
}

async function getUserLeaveBalance(email, env) {
  await ensureAllSheetsExist(env);
  const rows = await readSheet('Employees!A:C', env);
  if (!rows || rows.length < 2) return null;
  const searchEmail = email.toLowerCase().trim();
  const rowIndex = rows.slice(1).findIndex(row => (row[0] || '').toLowerCase().trim() === searchEmail);
  if (rowIndex === -1) return null;
  const balance = parseFloat(rows[rowIndex+1][2]);
  return isNaN(balance) ? { balance: 0, rowIndex: rowIndex+1 } : { balance, rowIndex: rowIndex+1 };
}

async function isStaffValid(email, env) {
  const rows = await readSheet('Employees!A:C', env);
  if (!rows || rows.length < 2) return false;
  const searchEmail = email.toLowerCase().trim();
  return rows.slice(1).some(row => (row[0] || '').toLowerCase().trim() === searchEmail);
}

function calculateLeaveDays(startDate, endDate, halfDay) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end - start);
  let days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  if (halfDay !== 'full') days = days - 0.5;
  return days;
}

async function updateLeaveBalance(email, newBalance, env) {
  const rows = await readSheet('Employees!A:C', env);
  const searchEmail = email.toLowerCase().trim();
  const rowIndex = rows.slice(1).findIndex(row => (row[0] || '').toLowerCase().trim() === searchEmail);
  if (rowIndex === -1) throw new Error('Email not found');
  const actualRow = rowIndex + 2;
  await updateSheet(`Employees!C${actualRow}`, [[newBalance]], env);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// ============ HTML DASHBOARD ============
const HTML_DASHBOARD = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Versafac HR - Smart Leave & Claim System</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',sans-serif; background:#f0f4f8; color:#1a2c3e; padding:16px; }
    .container { max-width:1400px; margin:0 auto; }
    .header { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:24px; padding:12px 20px; background:white; border-radius:40px; box-shadow:0 4px 12px rgba(0,0,0,0.05); }
    .logo h1 { font-size:1.6rem; font-weight:800; background:linear-gradient(135deg, #00aa6e, #00e6a0); -webkit-background-clip:text; background-clip:text; color:transparent; }
    .admin-btn { background:#00aa6e; color:white; border:none; padding:8px 20px; border-radius:40px; font-weight:700; cursor:pointer; text-decoration:none; }
    .tabs { display:flex; gap:10px; margin-bottom:24px; flex-wrap:wrap; }
    .tab { padding:10px 24px; border-radius:40px; font-weight:600; cursor:pointer; background:#eef2f8; border:none; }
    .tab.active { background:#00cc88; color:white; }
    .card { background:white; border-radius:28px; padding:20px; box-shadow:0 8px 20px rgba(0,0,0,0.05); }
    .two-columns { display:grid; grid-template-columns:1fr 1fr; gap:24px; }
    .form-group { margin-bottom:16px; }
    label { font-weight:600; display:block; margin-bottom:6px; font-size:0.85rem; }
    input, select, textarea { width:100%; padding:12px 16px; border-radius:28px; border:1px solid #dce5ef; font-family:inherit; }
    button { background:linear-gradient(100deg, #00b377, #00e6a0); border:none; padding:12px 20px; border-radius:40px; font-weight:700; cursor:pointer; color:#03231c; }
    .badge-add { background:rgba(0,204,136,0.15); padding:8px 18px; border-radius:40px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:8px; margin-right:10px; margin-bottom:10px; }
    .request-item { background:#f8fafc; border-radius:20px; padding:14px; margin-bottom:12px; display:flex; justify-content:space-between; flex-wrap:wrap; align-items:center; }
    .chat-area { height:450px; display:flex; flex-direction:column; }
    .chat-messages { flex:1; overflow-y:auto; margin-bottom:16px; padding:8px; background:#f9fafc; border-radius:24px; }
    .msg-user { text-align:right; margin:10px 0; color:#00aa6e; font-weight:600; }
    .msg-ai { background:#eef2ff; padding:10px 16px; border-radius:24px; display:inline-block; max-width:85%; margin:6px 0; }
    .flex-row { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; }
    @media (max-width:768px) { .two-columns { grid-template-columns:1fr; } }
  </style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="logo"><h1><i class="fas fa-leaf"></i> Versafac HR</h1></div>
    <a href="/admin" target="_blank" class="admin-btn"><i class="fas fa-user-shield"></i> HR/Manager Access</a>
  </div>
  <div class="tabs">
    <button class="tab active" data-tab="request">📋 Request</button>
    <button class="tab" data-tab="chat">🤖 AI Assistant</button>
    <button class="tab" data-tab="history">📜 History</button>
  </div>
  <div id="request-tab" class="tab-pane active">
    <div class="two-columns">
      <div class="card">
        <h3>Staff Information</h3>
        <div class="form-group"><label>📧 Email</label><input type="email" id="reqEmail"></div>
        <div class="form-group"><label>👤 Full Name</label><input type="text" id="reqName"></div>
        <h3>Add Request</h3>
        <div>
          <span class="badge-add" data-type="leave"><i class="fas fa-calendar-alt"></i> Leave</span>
          <span class="badge-add" data-type="ot"><i class="fas fa-clock"></i> Overtime</span>
          <span class="badge-add" data-type="claim"><i class="fas fa-receipt"></i> Claim</span>
        </div>
        <h3 style="margin-top:20px;">Attach Receipt</h3>
        <div class="flex-row">
          <select id="receiptType" style="flex:1;"><option>Meal</option><option>TNG</option><option>Hotel</option><option>Item</option></select>
          <input type="text" id="receiptDesc" placeholder="Description" style="flex:2;">
          <input type="file" id="receiptFile" accept=".pdf,image/*" style="flex:2;">
          <button id="uploadReceiptBtn"><i class="fas fa-upload"></i> Upload</button>
        </div>
        <div id="uploadFeedback" style="font-size:0.8rem;margin-top:6px;color:#00aa6e;"></div>
      </div>
      <div class="card">
        <h3>Request List <span id="reqCount">(0)</span></h3>
        <div id="requestsList"><div style="text-align:center;padding:30px;">No requests yet</div></div>
        <button id="submitAllBtn" style="width:100%;margin-top:16px;"><i class="fas fa-paper-plane"></i> Submit All (One Click)</button>
        <div id="submitResult" style="margin-top:16px;padding:12px;border-radius:28px;display:none;"></div>
      </div>
    </div>
  </div>
  <div id="chat-tab" class="tab-pane" style="display:none;">
    <div class="card chat-area">
      <h3><i class="fas fa-robot"></i> AI Assistant</h3>
      <div id="chatBox" class="chat-messages"><div class="msg-ai">✨ Hi! I'm your HR assistant. Ask me about leave, claims, or overtime.</div></div>
      <div class="flex-row">
        <input type="email" id="chatEmail" placeholder="Your email" style="flex:1;">
        <input type="text" id="chatInput" placeholder="Type your question..." style="flex:3;">
        <button id="sendChatBtn"><i class="fas fa-paper-plane"></i> Send</button>
      </div>
    </div>
  </div>
  <div id="history-tab" class="tab-pane" style="display:none;">
    <div class="card">
      <h3><i class="fas fa-history"></i> Submission History</h3>
      <div class="flex-row" style="margin-bottom:16px;">
        <input type="email" id="historyEmail" placeholder="Email" style="flex:2;">
        <button id="loadHistoryBtn"><i class="fas fa-search"></i> Load</button>
      </div>
      <div id="historyList" style="max-height:500px;overflow-y:auto;"></div>
    </div>
  </div>
</div>
<script>
// Simple dashboard JS
let requests = [];
let nextId = 1;

const reqEmail = document.getElementById('reqEmail');
const reqName = document.getElementById('reqName');
const requestsContainer = document.getElementById('requestsList');
const submitAllBtn = document.getElementById('submitAllBtn');

function renderRequests() {
  if (!requests.length) {
    requestsContainer.innerHTML = '<div style="text-align:center;padding:30px;">No requests yet</div>';
    document.getElementById('reqCount').innerText = '(0)';
    return;
  }
  let html = '';
  for (let r of requests) {
    html += '<div class="request-item"><div>' + r.type + ' - ' + (r.leaveType || r.claimType || 'OT') + '</div><div><button class="remove-req" data-id="' + r.id + '"><i class="fas fa-trash"></i></button></div></div>';
  }
  requestsContainer.innerHTML = html;
  document.getElementById('reqCount').innerText = '(' + requests.length + ')';
  
  document.querySelectorAll('.remove-req').forEach(btn => {
    btn.addEventListener('click', () => {
      requests = requests.filter(r => r.id !== parseInt(btn.dataset.id));
      renderRequests();
    });
  });
}

document.querySelectorAll('.badge-add').forEach(b => {
  b.addEventListener('click', () => {
    const email = reqEmail.value.trim();
    const name = reqName.value.trim();
    if (!email || !name) { alert('Please enter email and full name first.'); return; }
    requests.push({ id: nextId++, type: b.dataset.type, leaveType: 'Annual', claimType: 'Meal' });
    renderRequests();
  });
});

submitAllBtn.onclick = async () => {
  if (!requests.length) { alert('No requests'); return; }
  alert('Submitting ' + requests.length + ' requests...');
  requests = [];
  renderRequests();
};

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
    document.getElementById(tab.dataset.tab + '-tab').style.display = 'block';
  });
});

// Chat
document.getElementById('sendChatBtn').onclick = async () => {
  const email = document.getElementById('chatEmail').value;
  const msg = document.getElementById('chatInput').value;
  if (!email || !msg) return;
  const chatBox = document.getElementById('chatBox');
  chatBox.innerHTML += '<div class="msg-user">' + msg + '</div>';
  document.getElementById('chatInput').value = '';
  const loading = document.createElement('div');
  loading.className = 'msg-ai';
  loading.innerText = '...';
  chatBox.appendChild(loading);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, email: email, language: 'en' })
    });
    const data = await res.json();
    loading.innerText = data.reply || 'Error';
  } catch(e) { loading.innerText = 'Network error'; }
  chatBox.scrollTop = chatBox.scrollHeight;
};

// History
document.getElementById('loadHistoryBtn').onclick = async () => {
  const email = document.getElementById('historyEmail').value;
  if (!email) return;
  const res = await fetch('/api/get-history?email=' + encodeURIComponent(email));
  const data = await res.json();
  const historyDiv = document.getElementById('historyList');
  if (!data.success) { historyDiv.innerHTML = '<p>Error loading history</p>'; return; }
  if (!data.history.length) { historyDiv.innerHTML = '<p>No records found</p>'; return; }
  let html = '';
  for (let h of data.history) {
    html += '<div style="background:#f8fafc;border-radius:20px;padding:14px;margin-bottom:12px;">' + h.type + ' - ' + (h.status || 'pending') + '</div>';
  }
  historyDiv.innerHTML = html;
};

renderRequests();
</script>
</body>
</html>`;

// ============ WORKER HANDLER ============
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Auto-create sheets on startup
    try {
      await ensureAllSheetsExist(env);
    } catch (e) {
      console.error('Auto-create error:', e);
    }

    // Admin auth
    const isAdminPath = path === '/admin' || path === '/api/approve-request';
    if (isAdminPath) {
      const auth = request.headers.get('Authorization');
      const expectedPassword = env.ADMIN_PASSWORD || 'admin123';
      if (!auth || !auth.startsWith('Basic ')) {
        return new Response('Unauthorized', { 
          status: 401, 
          headers: { 'WWW-Authenticate': 'Basic realm="Admin Area"' } 
        });
      }
      const credentials = atob(auth.split(' ')[1]);
      const [username, password] = credentials.split(':');
      if (username !== 'admin' || password !== expectedPassword) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    // Routes
    if (path === '/') {
      return new Response(HTML_DASHBOARD, { headers: { 'Content-Type': 'text/html' } });
    }

    if (path === '/admin') {
      return new Response('<h1>Admin Panel</h1><p>Welcome to Versafac HR Admin</p>', { headers: { 'Content-Type': 'text/html' } });
    }

    // API Routes
    if (path === '/api/chat' && method === 'POST') {
      try {
        const { message, email } = await request.json();
        return Response.json({ reply: 'AI reply: ' + message + ' (Email: ' + email + ')' });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    if (path === '/api/get-history' && method === 'GET') {
      const email = url.searchParams.get('email');
      return Response.json({ success: true, history: [] });
    }

    if (path === '/api/check-staff' && method === 'POST') {
      try {
        const { email } = await request.json();
        const valid = await isStaffValid(email, env);
        return Response.json({ valid });
      } catch (e) {
        return Response.json({ valid: false, error: e.message });
      }
    }

    if (path === '/api/submit-leave' && method === 'POST') {
      try {
        const { email, name, leaveType, halfDay, startDate, endDate } = await request.json();
        const valid = await isStaffValid(email, env);
        if (!valid) return Response.json({ error: 'Email not registered' }, { status: 400 });
        const userBalance = await getUserLeaveBalance(email, env);
        const daysRequested = calculateLeaveDays(startDate, endDate, halfDay);
        if (daysRequested > (userBalance?.balance || 0)) {
          return Response.json({ error: 'Insufficient leave balance' }, { status: 400 });
        }
        await appendToSheet('LeaveRequests!A:K', [[formatTimestamp(), Date.now().toString(), email, name, leaveType, halfDay, startDate, endDate, halfDay === 'full' ? 'Full Day' : 'Half Day', 'pending', '']], env);
        await sendTelegramNotification(env, `📋 NEW LEAVE\nName: ${name}\nEmail: ${email}\nType: ${leaveType}\nDate: ${startDate} → ${endDate}`);
        await sendEmailToHR(env, name, email, 'Leave', 'Type: ' + leaveType + '\nDate: ' + startDate + ' → ' + endDate);
        return Response.json({ success: true });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    if (path === '/api/submit-overtime' && method === 'POST') {
      try {
        const { email, fullName, startDateTime, endDateTime, hours, amount } = await request.json();
        const valid = await isStaffValid(email, env);
        if (!valid) return Response.json({ error: 'Email not registered' }, { status: 400 });
        await appendToSheet('OvertimeRequests!A:K', [[formatTimestamp(), Date.now().toString(), email, fullName, startDateTime, hours || 0, 0, amount || 0, '', 'pending', '']], env);
        return Response.json({ success: true });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    if (path === '/api/submit-claim' && method === 'POST') {
      try {
        const { email, fullName, claimDate, items } = await request.json();
        const valid = await isStaffValid(email, env);
        if (!valid) return Response.json({ error: 'Email not registered' }, { status: 400 });
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const sheetName = 'Claims_' + it.claimType.replace(/ /g, '_');
          await appendToSheet(`${sheetName}!A:Z`, [[formatTimestamp(), Date.now().toString() + '_' + i, email, fullName, claimDate, it.amount || 0, 'pending', '']], env);
        }
        return Response.json({ success: true });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    if (path === '/api/upload-receipt' && method === 'POST') {
      try {
        const formData = await request.formData();
        const email = formData.get('email');
        const fullName = formData.get('fullName');
        const receiptType = formData.get('receiptType');
        const file = formData.get('file');
        if (!email || !fullName || !receiptType || !file) throw new Error('Incomplete data');
        const valid = await isStaffValid(email, env);
        if (!valid) return Response.json({ error: 'Email not registered' }, { status: 400 });
        let fileUrl = '';
        try {
          const ext = file.name.split('.').pop();
          const fileName = `receipt_${Date.now()}_${email.replace(/[^a-z0-9]/gi, '_')}.${ext}`;
          fileUrl = await uploadToDrive(file, fileName, file.type, env);
        } catch (uploadErr) { fileUrl = 'UPLOAD_FAILED'; }
        await appendToSheet('Receipts!A:G', [[formatTimestamp(), email, fullName, receiptType, fileUrl, '', 'pending']], env);
        return Response.json({ success: true, fileUrl });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};
