// @ts-nocheck
// ============================================================
// VERSAFAC HR SYSTEM - VERSION 3.0
// Owner: versafac12@gmail.com
// Fully Bilingual (MS/EN) | Auto-create Sheets | Separated Claims
// ============================================================

const DEFAULT_SPREADSHEET_ID = '1WnPtfeF_Sg5EOu6KxjvYr6cddOEAdy9tYOy1trizB7Q';
const DEFAULT_GOOGLE_DRIVE_FOLDER_ID = '1D-q-1VJjv-f4wnxqaj14P49DpCGPFBA3';

// ============================================================
// HELPER FUNCTIONS
// ============================================================

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

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

function calculateLeaveDays(startDate, endDate, halfDay) {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  const diffTime = Math.abs(end - start);
  let days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  if (halfDay !== 'full') days = days - 0.5;
  return days > 0 ? days : 0;
}

function calculateHours(start, end) {
  if (!start || !end) return 0;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return 0;
  const diff = endDate - startDate;
  const hours = Math.round((diff / 3600000) * 2) / 2;
  return hours > 0 ? hours : 0;
}

function getSuggestedRate(d) {
  const day = new Date(d).getDay();
  if (day === 0) return 25;
  if (day === 6) return 20;
  return 15;
}

function detectLanguageSmart(text) {
  const lower = text.toLowerCase();
  if (['baki cuti', 'cuti saya', 'claim saya', 'lebih masa', 'jumlah', 'status', 'tuntutan'].some(k => lower.includes(k))) return 'ms';
  return 'en';
}

// ============================================================
// TELEGRAM NOTIFICATION (ALWAYS ENGLISH)
// ============================================================

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

// ============================================================
// EMAIL NOTIFICATION
// ============================================================

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

// ============================================================
// GOOGLE API FUNCTIONS
// ============================================================

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

async function readSheet(range, env) {
  const token = await getGoogleAccessToken(env);
  const spreadsheetId = env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { if (res.status === 404) return []; throw new Error('Failed to read sheet'); }
  const data = await res.json();
  return data.values || [];
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

async function uploadToDrive(file, fileName, mimeType, env) {
  try {
    // Get access token using refresh token
    const token = await getAccessTokenWithRefreshToken(env);
    
    const folderId = env.GOOGLE_DRIVE_FOLDER_ID || DEFAULT_GOOGLE_DRIVE_FOLDER_ID;
    
    const metadata = { 
      name: fileName, 
      parents: [folderId], 
      mimeType 
    };
    
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file, fileName);
    
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: form
    });
    
    const data = await res.json();
    
    if (!data.id) {
      throw new Error('Upload failed: ' + JSON.stringify(data));
    }
    
    // Set public access
    await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    });
    
    return `https://drive.google.com/file/d/${data.id}/view`;
  } catch (e) {
    console.error('Upload error:', e);
    throw e;
  }
}

async function getAccessTokenWithRefreshToken(env) {
  const refreshToken = env.GOOGLE_REFRESH_TOKEN;
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  
  if (!refreshToken) {
    throw new Error('GOOGLE_REFRESH_TOKEN not set');
  }
  
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  
  const data = await response.json();
  if (!data.access_token) {
    throw new Error('Failed to refresh token: ' + JSON.stringify(data));
  }
  return data.access_token;
}

// ============================================================
// AUTO-CREATE ALL SHEETS (ENGLISH HEADERS)
// ============================================================

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

async function ensureSheetExists(sheetName, env) {
  await ensureAllSheetsExist(env);
}

// ============================================================
// EMPLOYEE FUNCTIONS
// ============================================================

async function isStaffValid(email, env) {
  const rows = await readSheet('Employees!A:C', env);
  if (!rows || rows.length < 2) return false;
  const searchEmail = email.toLowerCase().trim();
  return rows.slice(1).some(row => (row[0] || '').toLowerCase().trim() === searchEmail);
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

async function updateLeaveBalance(email, newBalance, env) {
  const rows = await readSheet('Employees!A:C', env);
  const searchEmail = email.toLowerCase().trim();
  const rowIndex = rows.slice(1).findIndex(row => (row[0] || '').toLowerCase().trim() === searchEmail);
  if (rowIndex === -1) throw new Error('Email not found');
  const actualRow = rowIndex + 2;
  await updateSheet(`Employees!C${actualRow}`, [[newBalance]], env);
}
// ============================================================
// EMPLOYEE & SETTINGS FUNCTIONS
// ============================================================

async function getAllEmployees(env) {
  await ensureAllSheetsExist(env);
  const rows = await readSheet('Employees!A:C', env);
  if (!rows || rows.length < 2) return [];
  return rows.slice(1).map(row => ({
    email: row[0],
    name: row[1],
    annualLeave: parseFloat(row[2]) || 0
  }));
}

async function getSettings(env) {
  await ensureAllSheetsExist(env);
  const rows = await readSheet('Settings!A:B', env);
  
  const settings = {
    distanceRate: 0.60,
    hotelRate: 150,
    otRateWeekday: 15,
    otRateSaturday: 20,
    otRateSunday: 25
  };
  
  for (const row of rows.slice(1)) {
    if (row[0] === 'distanceRate') settings.distanceRate = parseFloat(row[1]) || 0.60;
    if (row[0] === 'hotelRate') settings.hotelRate = parseFloat(row[1]) || 150;
    if (row[0] === 'otRateWeekday') settings.otRateWeekday = parseFloat(row[1]) || 15;
    if (row[0] === 'otRateSaturday') settings.otRateSaturday = parseFloat(row[1]) || 20;
    if (row[0] === 'otRateSunday') settings.otRateSunday = parseFloat(row[1]) || 25;
  }
  return settings;
}

async function addNewEmployee(email, name, annualLeave, env) {
  await ensureAllSheetsExist(env);
  await appendToSheet('Employees!A:C', [[email, name, annualLeave]], env);
}

async function updateEmployeeEmail(oldEmail, newEmail, newName, env) {
  const rows = await readSheet('Employees!A:C', env);
  const searchEmail = oldEmail.toLowerCase().trim();
  const rowIndex = rows.slice(1).findIndex(row => (row[0] || '').toLowerCase().trim() === searchEmail);
  if (rowIndex === -1) throw new Error('Email not found');
  const actualRow = rowIndex + 2;
  await updateSheet(`Employees!A${actualRow}`, [[newEmail]], env);
  if (newName) {
    await updateSheet(`Employees!B${actualRow}`, [[newName]], env);
  }
  return true;
}

async function updateEmployeeNameAndLeave(email, newName, newBalance, env) {
  const rows = await readSheet('Employees!A:C', env);
  const searchEmail = email.toLowerCase().trim();
  const rowIndex = rows.slice(1).findIndex(row => (row[0] || '').toLowerCase().trim() === searchEmail);
  if (rowIndex === -1) throw new Error('Email not found');
  const actualRow = rowIndex + 2;
  if (newName) {
    await updateSheet(`Employees!B${actualRow}`, [[newName]], env);
  }
  await updateSheet(`Employees!C${actualRow}`, [[newBalance]], env);
  return true;
}

async function updateSetting(key, value, env) {
  await ensureAllSheetsExist(env);
  const rows = await readSheet('Settings!A:B', env);
  
  let found = false;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === key) {
      await updateSheet(`Settings!B${i+1}`, [[value]], env);
      found = true;
      break;
    }
  }
  if (!found) {
    await appendToSheet('Settings!A:B', [[key, value]], env);
  }
}

// ============================================================
// AI FUNCTIONS (FULLY BILINGUAL)
// ============================================================

async function getLeaveBalanceAI(email, env, lang) {
  const data = await getUserLeaveBalance(email, env);
  if (!data) return lang === 'ms' ? '❌ Email tidak ditemui.' : '❌ Email not found.';
  return lang === 'ms' ? `✅ Baki cuti: ${data.balance} hari` : `✅ Leave balance: ${data.balance} days`;
}

async function getLeaveStatusAI(email, env, lang) {
  try {
    const rows = await readSheet('LeaveRequests!A:K', env);
    const leaves = rows.slice(1).filter(r => r[2]?.toLowerCase() === email.toLowerCase()).map(r => ({ type: r[4], startDate: r[6], endDate: r[7], status: r[9] }));
    if (!leaves.length) return lang === 'ms' ? 'Tiada permohonan cuti.' : 'No leave requests.';
    return leaves.slice(-3).map(l => `${l.status === 'approved' ? '✅' : l.status === 'rejected' ? '❌' : '⏳'} ${l.type} (${l.startDate} → ${l.endDate})`).join('\n');
  } catch { return lang === 'ms' ? 'Ralat baca cuti.' : 'Error reading leaves.'; }
}

async function getClaimStatusAI(email, env, lang) {
  try {
    const claimSheets = ['Claims_Hotel', 'Claims_Distance', 'Claims_Meal', 'Claims_TNG', 'Claims_Item'];
    let allClaims = [];
    for (const sheet of claimSheets) {
      const rows = await readSheet(`${sheet}!A:Z`, env);
      if (rows && rows.length > 1) {
        for (const r of rows.slice(1)) {
          if (r[2]?.toLowerCase() === email.toLowerCase()) {
            const statusIndex = r.length - 2;
            const amountIndex = r.length - 3;
            allClaims.push({
              type: sheet.replace('Claims_', ''),
              amount: parseFloat(r[amountIndex]) || 0,
              status: r[statusIndex] || 'pending'
            });
          }
        }
      }
    }
    if (!allClaims.length) return lang === 'ms' ? 'Tiada tuntutan.' : 'No claims.';
    return allClaims.slice(-3).map(c => `${c.status === 'approved' ? '✅' : c.status === 'rejected' ? '❌' : '⏳'} ${c.type} - RM${c.amount}`).join('\n');
  } catch { return lang === 'ms' ? 'Ralat baca tuntutan.' : 'Error reading claims.'; }
}

async function getOTStatusAI(email, env, lang) {
  try {
    const rows = await readSheet('OvertimeRequests!A:K', env);
    const ots = rows.slice(1).filter(r => r[2]?.toLowerCase() === email.toLowerCase()).map(r => ({ date: r[4], hours: r[5], amount: r[7], status: r[9] }));
    if (!ots.length) return lang === 'ms' ? 'Tiada permohonan lebih masa.' : 'No OT requests.';
    return ots.slice(-3).map(o => `${o.status === 'approved' ? '✅' : o.status === 'rejected' ? '❌' : '⏳'} ${o.date} - ${o.hours}h = RM${o.amount}`).join('\n');
  } catch { return lang === 'ms' ? 'Ralat baca OT.' : 'Error reading OT.'; }
}

async function getMonthlyClaimTotal(email, month, year, env) {
  try {
    const claimSheets = ['Claims_Hotel', 'Claims_Distance', 'Claims_Meal', 'Claims_TNG', 'Claims_Item'];
    let total = 0, count = 0;
    for (const sheet of claimSheets) {
      const rows = await readSheet(`${sheet}!A:Z`, env);
      if (rows && rows.length > 1) {
        for (const r of rows.slice(1)) {
          if (r[2]?.toLowerCase() !== email.toLowerCase()) continue;
          const d = r[4];
          if (d) {
            const parts = d.split('-');
            const y = parseInt(parts[0]);
            const m = parseInt(parts[1]);
            if (y === year && m === month) {
              const amountIndex = r.length - 3;
              total = total + (parseFloat(r[amountIndex]) || 0);
              count = count + 1;
            }
          }
        }
      }
    }
    return { total, count };
  } catch { return { total: 0, count: 0 }; }
}

async function getMonthlyOTTotal(email, month, year, env) {
  try {
    const rows = await readSheet('OvertimeRequests!A:K', env);
    let total = 0, hours = 0, count = 0;
    for (const r of rows.slice(1)) {
      if (r[2]?.toLowerCase() !== email.toLowerCase()) continue;
      const d = r[4];
      if (d) {
        const parts = d.split('-');
        const y = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        if (y === year && m === month) {
          total = total + (parseFloat(r[7]) || 0);
          hours = hours + (parseFloat(r[5]) || 0);
          count = count + 1;
        }
      }
    }
    return { total, hours, count };
  } catch { return { total: 0, hours: 0, count: 0 }; }
}

async function getSmartAIResponse(message, email, lang, env) {
  const lower = message.toLowerCase();
  
  // HELP
  if (lower.includes('help') || lower.includes('guide') || lower.includes('bantuan') || lower.includes('panduan')) {
    return lang === 'ms' 
      ? '📖 Panduan:\n• "baki cuti saya?"\n• "status cuti saya?"\n• "jumlah claim bulan ini?"\n• "jumlah OT bulan lepas"\n• "status claim saya"\n• "status ot saya"'
      : '📖 Guide:\n• "my leave balance"\n• "my leave status"\n• "total claims this month"\n• "total overtime last month"\n• "my claim status"\n• "my ot status"';
  }
  
  // LEAVE BALANCE
  if (lower.includes('baki cuti') || lower.includes('leave balance') || lower.includes('cuti saya')) {
    return await getLeaveBalanceAI(email, env, lang);
  }
  
  // LEAVE STATUS
  if (lower.includes('status cuti') || lower.includes('leave status')) {
    return await getLeaveStatusAI(email, env, lang);
  }
  
  // CLAIM TOTAL
  if (lower.includes('jumlah claim') || lower.includes('total claim') || lower.includes('tuntutan bulan')) {
    const now = new Date();
    const { total, count } = await getMonthlyClaimTotal(email, now.getMonth() + 1, now.getFullYear(), env);
    return lang === 'ms' 
      ? `📊 Jumlah tuntutan bulan ini: RM ${total.toFixed(2)} (${count} item)`
      : `📊 Total claims this month: RM ${total.toFixed(2)} (${count} items)`;
  }
  
  // OT TOTAL
  if (lower.includes('jumlah ot') || lower.includes('total overtime') || lower.includes('lebih masa bulan')) {
    const now = new Date();
    const { total, hours } = await getMonthlyOTTotal(email, now.getMonth() + 1, now.getFullYear(), env);
    return lang === 'ms' 
      ? `⏰ Jumlah lebih masa bulan ini: ${hours} jam = RM ${total.toFixed(2)}`
      : `⏰ Total OT this month: ${hours} hours = RM ${total.toFixed(2)}`;
  }
  
  // CLAIM STATUS
  if (lower.includes('status claim') || lower.includes('status tuntutan') || lower.includes('claim saya')) {
    return await getClaimStatusAI(email, env, lang);
  }
  
  // OT STATUS
  if (lower.includes('status ot') || lower.includes('status overtime') || lower.includes('ot saya')) {
    return await getOTStatusAI(email, env, lang);
  }
  
  // DEFAULT
  return lang === 'ms' 
    ? '💡 Taip "help" untuk panduan atau tanya soalan tentang cuti, tuntutan, atau lebih masa.'
    : '💡 Type "help" for guide or ask about leave, claims, or overtime.';
}

// ============================================================
// EXPORT MONTHLY REPORT
// ============================================================

async function generateMonthlyReport(env, year, month, lang = 'ms') {
  const leaves = await readSheet('LeaveRequests!A:K', env);
  const ots = await readSheet('OvertimeRequests!A:K', env);
  const employees = await getAllEmployees(env);
  
  // Get all claims from separated sheets
  const claimSheets = ['Claims_Hotel', 'Claims_Distance', 'Claims_Meal', 'Claims_TNG', 'Claims_Item'];
  let allClaims = [];
  for (const sheet of claimSheets) {
    const rows = await readSheet(`${sheet}!A:Z`, env);
    if (rows && rows.length > 1) {
      for (const r of rows.slice(1)) {
        if (r[4]?.startsWith(`${year}-${String(month).padStart(2, '0')}`)) {
          const amountIndex = r.length - 3;
          allClaims.push({
            name: r[3] || '',
            type: sheet.replace('Claims_', ''),
            date: r[4] || '',
            amount: parseFloat(r[amountIndex]) || 0,
            status: r[r.length - 2] || 'pending'
          });
        }
      }
    }
  }
  
  const monthStr = String(month).padStart(2, '0');
  const filteredLeaves = leaves.slice(1).filter(r => r[6]?.startsWith(`${year}-${monthStr}`));
  const filteredOts = ots.slice(1).filter(r => r[4]?.startsWith(`${year}-${monthStr}`));
  
  const t = lang === 'ms' ? {
    title: `Laporan Bulanan - ${month}/${year}`,
    employees: 'Senarai Pekerja',
    leaveRequests: 'Permohonan Cuti',
    overtimeRequests: 'Permohonan Lebih Masa',
    claims: 'Tuntutan',
    name: 'Nama',
    email: 'Email',
    type: 'Jenis',
    date: 'Tarikh',
    amount: 'Jumlah',
    status: 'Status'
  } : {
    title: `Monthly Report - ${month}/${year}`,
    employees: 'Employee List',
    leaveRequests: 'Leave Requests',
    overtimeRequests: 'Overtime Requests',
    claims: 'Claims',
    name: 'Name',
    email: 'Email',
    type: 'Type',
    date: 'Date',
    amount: 'Amount',
    status: 'Status'
  };
  
  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${t.title}</title>
  <style>body{font-family:Arial;padding:20px}h1{color:#00aa6e}h2{margin-top:30px;border-bottom:2px solid #00aa6e}
  table{width:100%;border-collapse:collapse;margin:15px 0}th,td{border:1px solid #ddd;padding:8px 12px}
  th{background:#00aa6e20}.footer{margin-top:30px;font-size:12px;text-align:center}</style></head>
  <body><h1>${t.title}</h1><h2>${t.employees}</h2><table><thead><tr><th>${t.email}</th><th>${t.name}</th><th>Annual Leave</th></tr></thead><tbody>`;
  for (const emp of employees) html += `<tr><td>${escapeHtml(emp.email)}</td><td>${escapeHtml(emp.name)}</td><td>${emp.annualLeave}</td></tr>`;
  html += `</tbody></table><h2>${t.leaveRequests}</h2><table><thead><tr><th>${t.name}</th><th>${t.type}</th><th>${t.date}</th><th>${t.status}</th></tr></thead><tbody>`;
  for (const l of filteredLeaves) html += `<tr><td>${escapeHtml(l[3])}</td><td>${l[4]}</td><td>${l[6]} → ${l[7]}</td><td>${l[9]}</td></tr>`;
  html += `</tbody></table><h2>${t.overtimeRequests}</h2><table><thead><tr><th>${t.name}</th><th>${t.date}</th><th>Hours</th><th>${t.amount}</th><th>${t.status}</th></tr></thead><tbody>`;
  for (const ot of filteredOts) html += `<tr><td>${escapeHtml(ot[3])}</td><td>${ot[4]}</td><td>${ot[5]}</td><td>RM${parseFloat(ot[7]).toFixed(2)}</td><td>${ot[9]}</td></tr>`;
  html += `</tbody></table><h2>${t.claims}</h2><table><thead><tr><th>${t.name}</th><th>${t.type}</th><th>${t.date}</th><th>${t.amount}</th><th>${t.status}</th></tr></thead><tbody>`;
  for (const c of allClaims) html += `<tr><td>${escapeHtml(c.name)}</td><td>${c.type}</td><td>${c.date}</td><td>RM${c.amount.toFixed(2)}</td><td>${c.status}</td></tr>`;
  html += `</tbody></table><div class="footer">Generated on: ${formatTimestamp()}</div></body></html>`;
  return html;
}

// ============================================================
// HTML DASHBOARD - COMPLETE VERSION
// ============================================================

const HTML_DASHBOARD = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
  <title>Versafac HR - Smart Leave & Claim System</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300;400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',sans-serif; transition:all 0.3s ease; min-height:100vh; padding:16px; background:#f0f4f8; color:#1a2c3e; }
    body.dark { background:#0b1a18; color:#e0f2e9; }
    .container { max-width:1400px; margin:0 auto; }
    .header { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:24px; padding:12px 20px; background:white; border-radius:40px; box-shadow:0 4px 12px rgba(0,0,0,0.05); }
    body.dark .header { background:rgba(20,35,30,0.9); border-bottom:1px solid rgba(0,255,170,0.3); }
    .logo h1 { font-size:1.6rem; font-weight:800; background:linear-gradient(135deg, #00aa6e, #00e6a0); -webkit-background-clip:text; background-clip:text; color:transparent; }
    .logo p { font-size:0.7rem; opacity:0.7; }
    .controls { display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
    .lang-btn, .mode-btn { background:#eef2f8; border:none; padding:8px 16px; border-radius:40px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px; }
    body.dark .lang-btn, body.dark .mode-btn { background:rgba(0,255,170,0.15); color:#b3ffe0; }
    .admin-btn { background:#00aa6e; color:white; border:none; padding:8px 20px; border-radius:40px; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:8px; text-decoration:none; box-shadow:0 2px 8px rgba(0,170,110,0.3); }
    .admin-btn:hover { transform:translateY(-2px); box-shadow:0 4px 12px rgba(0,170,110,0.4); }
    .tabs { display:flex; gap:10px; margin-bottom:24px; flex-wrap:wrap; }
    .tab { padding:10px 24px; border-radius:40px; font-weight:600; cursor:pointer; background:#eef2f8; color:#2c3e50; border:none; }
    body.dark .tab { background:rgba(255,255,255,0.1); color:#ccf0e5; }
    .tab.active { background:#00cc88; color:white; box-shadow:0 4px 12px rgba(0,204,136,0.3); }
    body.dark .tab.active { background:linear-gradient(105deg, #00aa6e, #00e0a0); color:#03100c; }
    .two-columns { display:grid; grid-template-columns:1fr 1fr; gap:24px; }
    .card { background:white; border-radius:28px; padding:20px; box-shadow:0 8px 20px rgba(0,0,0,0.05); transition:0.2s; }
    body.dark .card { background:rgba(20,35,30,0.8); border:1px solid rgba(0,255,170,0.2); }
    .section-title { font-size:1.3rem; font-weight:700; margin-bottom:16px; display:flex; align-items:center; gap:10px; }
    .form-group { margin-bottom:16px; }
    label { font-weight:600; display:block; margin-bottom:6px; font-size:0.85rem; }
    input, select, textarea { width:100%; padding:12px 16px; border-radius:28px; border:1px solid #dce5ef; background:white; font-family:inherit; }
    body.dark input, body.dark select, body.dark textarea { background:rgba(0,0,0,0.5); border-color:rgba(0,255,170,0.4); color:#edfff5; }
    input:focus, select:focus { outline:none; border-color:#00cc88; box-shadow:0 0 0 2px rgba(0,204,136,0.2); }
    button { background:linear-gradient(100deg, #00b377, #00e6a0); border:none; padding:12px 20px; border-radius:40px; font-weight:700; cursor:pointer; color:#03231c; font-size:0.9rem; transition:0.2s; }
    button:disabled { opacity:0.5; cursor:not-allowed; transform:none; }
    button:hover:not(:disabled) { transform:translateY(-2px); box-shadow:0 6px 14px rgba(0,204,136,0.4); }
    .badge-add { background:rgba(0,204,136,0.15); padding:8px 18px; border-radius:40px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:8px; margin-right:10px; margin-bottom:10px; }
    .badge-add:active { transform:scale(0.95); }
    .request-list-container { max-height:350px; overflow-y:auto; margin-top:16px; }
    .request-item { background:#f8fafc; border-radius:20px; padding:14px; margin-bottom:12px; display:flex; justify-content:space-between; flex-wrap:wrap; align-items:center; }
    body.dark .request-item { background:rgba(0,0,0,0.3); }
    .request-details { flex:2; font-size:0.85rem; }
    .claim-detail { margin-left:16px; padding-left:8px; border-left:2px solid #00cc88; margin-top:6px; }
    .btn-icon { background:none; padding:6px 12px; margin-left:6px; font-size:0.75rem; }
    .chat-area { height:450px; display:flex; flex-direction:column; }
    .chat-messages { flex:1; overflow-y:auto; margin-bottom:16px; padding:8px; background:#f9fafc; border-radius:24px; }
    body.dark .chat-messages { background:rgba(0,0,0,0.3); }
    .msg-user { text-align:right; margin:10px 0; color:#00aa6e; font-weight:600; }
    .msg-ai { background:#eef2ff; padding:10px 16px; border-radius:24px; display:inline-block; max-width:85%; margin:6px 0; border-left:3px solid #00cc88; }
    body.dark .msg-ai { background:rgba(0,255,170,0.1); color:#e0ffe8; }
    .flex-row { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; }
    .history-item { background:#f8fafc; border-radius:20px; padding:14px; margin-bottom:12px; }
    body.dark .history-item { background:rgba(0,0,0,0.3); }
    .file-feedback { font-size:0.8rem; margin-top:6px; color:#00aa6e; display:flex; align-items:center; gap:6px; }
    @media (max-width:768px) { .two-columns { grid-template-columns:1fr; } .header { flex-direction:column; text-align:center; } .tab { padding:6px 16px; font-size:0.8rem; } .section-title { font-size:1.1rem; } }
    .modal-overlay { position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:2000; }
    .modal-content { background:white; border-radius:32px; padding:24px; max-width:600px; width:90%; max-height:85vh; overflow:auto; }
    body.dark .modal-content { background:#152b24; color:#e0f2e9; }
    .error-msg { color:#dc3545; font-size:0.8rem; margin-top:4px; }
    .balance-badge { background:#00cc88; color:#03231c; padding:4px 12px; border-radius:20px; font-size:0.7rem; font-weight:600; margin-left:8px; }
  </style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="logo"><h1><i class="fas fa-leaf"></i> Versafac HR</h1><p id="subtitle">Smart Leave & Claim System</p></div>
    <div class="controls">
      <button class="lang-btn" id="langToggle"><i class="fas fa-globe"></i> <span id="langText">English</span></button>
      <button class="mode-btn" id="modeToggle"><i class="fas fa-moon"></i> <span id="modeText">Dark</span></button>
      <a href="/admin" target="_blank" class="admin-btn"><i class="fas fa-user-shield"></i> <span id="adminBtnText">HR/Manager Access</span></a>
    </div>
  </div>
  <div class="tabs">
    <button class="tab active" data-tab="request" id="tabRequest">📋 Request</button>
    <button class="tab" data-tab="chat" id="tabChat">🤖 AI Assistant</button>
    <button class="tab" data-tab="history" id="tabHistory">📜 History</button>
    <button class="tab" data-tab="calendar" id="tabCalendar">📅 Calendar</button>
  </div>

  <div id="request-tab" class="tab-pane active">
    <div class="two-columns">
      <div class="card">
        <div class="section-title"><i class="fas fa-user-circle"></i> <span id="staffInfoTitle">Staff Information</span></div>
        <div class="form-group"><label id="emailLabel">📧 Email</label><input type="email" id="reqEmail" placeholder="staff@versafac.com"></div>
        <div class="form-group"><label id="nameLabel">👤 Full Name</label><input type="text" id="reqName" placeholder="Full name"></div>
        <div class="section-title"><i class="fas fa-plus-circle"></i> <span id="addRequestTitle">Add Request</span></div>
        <div id="badgeContainer">
          <div class="badge-add" data-type="leave" id="leaveBadge"><i class="fas fa-calendar-alt"></i> <span>Leave</span></div>
          <div class="badge-add" data-type="ot" id="otBadge"><i class="fas fa-clock"></i> <span>Overtime</span></div>
          <div class="badge-add" data-type="claim" id="claimBadge"><i class="fas fa-receipt"></i> <span>Claim</span></div>
        </div>
        <div class="section-title" style="margin-top:24px; font-size:1rem;"><i class="fas fa-paperclip"></i> <span id="attachReceiptTitle">Attach Receipt</span></div>
        <div class="flex-row">
          <div style="flex:1">
            <select id="receiptType">
              <option>Meal</option>
              <option>TNG</option>
              <option>Hotel</option>
              <option>Item</option>
            </select>
          </div>
          <div style="flex:2">
            <input type="text" id="receiptDesc" placeholder="Description (e.g., Dinner)">
          </div>
          <div style="flex:2">
            <label style="display:block;font-size:0.8rem;margin-bottom:4px;">Choose File (PDF or Image)</label>
            <input type="file" id="receiptFile" accept=".pdf,.jpg,.jpeg,.png,.gif,.bmp,.webp" style="padding:8px;">
            <label for="receiptFile" style="font-size:0.7rem;color:#6b7280;margin-top:4px;display:block;">Accepted: PDF, JPG, PNG, GIF</label>
          </div>
          <button id="uploadReceiptBtn"><i class="fas fa-upload"></i> <span id="uploadBtnText">Upload</span></button>
        </div>
        <div id="uploadFeedback" class="file-feedback"></div>
      </div>
      <div class="card">
        <div class="section-title"><i class="fas fa-list-check"></i> <span id="requestListTitle">Request List</span> <span id="reqCount">(0)</span></div>
        <div id="requestsList" class="request-list-container"><div style="text-align:center; padding:30px;" id="emptyMsg">No requests yet</div></div>
        <button id="submitAllBtn" style="width:100%; margin-top:16px;"><i class="fas fa-paper-plane"></i> <span id="submitAllText">Submit All (One Click)</span></button>
        <div id="submitResult" style="margin-top:16px; padding:12px; border-radius:28px; display:none;"></div>
      </div>
    </div>
  </div>

  <div id="chat-tab" class="tab-pane" style="display:none;">
    <div class="card chat-area">
      <div class="section-title"><i class="fas fa-robot"></i> <span id="assistantTitle">AI Assistant</span></div>
      <div id="chatBox" class="chat-messages"><div class="msg-ai" id="welcomeMsg">✨ Hi! I'm your HR assistant. Ask me about leave, claims, or overtime.</div></div>
      <div class="flex-row" style="align-items:center;">
        <input type="email" id="chatEmail" placeholder="Your email" style="flex:1">
        <input type="text" id="chatInput" placeholder="Type your question..." style="flex:3">
        <button id="sendChatBtn"><i class="fas fa-paper-plane"></i> <span id="sendBtnText">Send</span></button>
      </div>
    </div>
  </div>

  <div id="history-tab" class="tab-pane" style="display:none;">
    <div class="card">
      <div class="section-title"><i class="fas fa-history"></i> <span id="historyTitle">Submission History</span></div>
      <div class="flex-row" style="margin-bottom:16px;"><input type="email" id="historyEmail" placeholder="Email" style="flex:2"><button id="loadHistoryBtn"><i class="fas fa-search"></i> <span id="loadBtnText">Load</span></button></div>
      <div id="historyList" style="max-height:500px; overflow-y:auto;"></div>
    </div>
  </div>

  <div id="calendar-tab" class="tab-pane" style="display:none;">
    <div class="card">
      <div class="section-title"><i class="fas fa-calendar-alt"></i> <span id="calendarTitle">Employee Leave Calendar</span></div>
      <div class="form-group">
        <label id="calendarMonthLabel">Select Month</label>
        <input type="month" id="calendarMonth" style="width:100%;">
      </div>
      <div id="calendarView" style="overflow-x:auto; margin-top:16px;"></div>
    </div>
  </div>
</div>

<script>
(function() {
  // ========== VARIABLES ==========
  let isModalOpen = false;
  let isSubmitting = false;
  let isUploading = false;
  let isSending = false;
  let isLoading = false;
  let isAddingItem = false;
  let isConfirming = false;
  let isBadgeClicking = false;
  let isAddingEditItem = false;
  
  let requests = [];
  let nextId = 1;
  let currentLang = 'en';
  let currentBalance = 0;
  
  const reqEmail = document.getElementById('reqEmail');
  const reqName = document.getElementById('reqName');
  const requestsContainer = document.getElementById('requestsList');
  const submitAllBtn = document.getElementById('submitAllBtn');
  const submitResultDiv = document.getElementById('submitResult');
  const langToggle = document.getElementById('langToggle');
  const modeToggle = document.getElementById('modeToggle');
  const body = document.body;
  const fileInput = document.getElementById('receiptFile');
  const uploadFeedback = document.getElementById('uploadFeedback');
  const adminBtnSpan = document.getElementById('adminBtnText');
  const uploadBtn = document.getElementById('uploadReceiptBtn');
  const sendChatBtn = document.getElementById('sendChatBtn');
  const loadHistoryBtn = document.getElementById('loadHistoryBtn');
  
  // ========== TRANSLATIONS ==========
  const translations = {
    ms: {
      subtitle: "Sistem Cuti & Tuntutan Pintar",
      langText: "Melayu",
      modeText: "Gelap",
      tabRequest: "📋 Permohonan",
      tabChat: "🤖 AI Assistant",
      tabHistory: "📜 Sejarah",
      tabCalendar: "📅 Kalendar",
      staffInfoTitle: "Maklumat Staf",
      emailLabel: "📧 Email",
      nameLabel: "👤 Nama Penuh",
      addRequestTitle: "Tambah Permohonan",
      leaveBadge: "Cuti",
      otBadge: "Lebih Masa",
      claimBadge: "Tuntutan",
      attachReceiptTitle: "Lampirkan Resit",
      uploadBtnText: "Muat Naik",
      requestListTitle: "Senarai Permohonan",
      emptyMsg: "Belum ada permohonan",
      submitAllText: "Hantar Semua (Satu Klik)",
      assistantTitle: "Pembantu AI",
      welcomeMsg: "✨ Hai! Saya pembantu HR. Tanya apa sahaja tentang cuti, tuntutan, atau lebih masa.",
      sendBtnText: "Hantar",
      historyTitle: "Sejarah Permohonan",
      loadBtnText: "Muat",
      calendarTitle: "Kalendar Cuti Pekerja",
      calendarMonthLabel: "Pilih Bulan",
      uploadOk: "Resit berjaya dimuat naik",
      uploadFail: "Muat naik gagal",
      fileSelected: "Fail dipilih: ",
      submitSuccess: "Semua permohonan berjaya dihantar!",
      submitFail: "Ralat",
      waiting: "Memproses...",
      leaveInsufficient: "Baki cuti tahunan tidak mencukupi! Baki anda: ",
      pleaseEnterEmailName: "Sila isi email dan nama penuh terlebih dahulu.",
      staffNotRegistered: "Email tidak berdaftar dalam sistem. Sila hubungi HR.",
      deleteConfirm: "Padam permohonan ini? Tindakan ini tidak boleh dibatalkan.",
      deleteSuccess: "Berjaya dipadam",
      deleteError: "Gagal memadam",
      adminBtnText: "Akses HR/Manager",
      pleaseWait: "Sila tunggu, sedang diproses...",
      selectFile: "Pilih fail"
    },
    en: {
      subtitle: "Smart Leave & Claim System",
      langText: "English",
      modeText: "Dark",
      tabRequest: "📋 Request",
      tabChat: "🤖 AI Assistant",
      tabHistory: "📜 History",
      tabCalendar: "📅 Calendar",
      staffInfoTitle: "Staff Information",
      emailLabel: "📧 Email",
      nameLabel: "👤 Full Name",
      addRequestTitle: "Add Request",
      leaveBadge: "Leave",
      otBadge: "Overtime",
      claimBadge: "Claim",
      attachReceiptTitle: "Attach Receipt",
      uploadBtnText: "Upload",
      requestListTitle: "Request List",
      emptyMsg: "No requests yet",
      submitAllText: "Submit All (One Click)",
      assistantTitle: "AI Assistant",
      welcomeMsg: "✨ Hi! I'm your HR assistant. Ask me about leave, claims, or overtime.",
      sendBtnText: "Send",
      historyTitle: "Submission History",
      loadBtnText: "Load",
      calendarTitle: "Employee Leave Calendar",
      calendarMonthLabel: "Select Month",
      uploadOk: "Receipt uploaded successfully",
      uploadFail: "Upload failed",
      fileSelected: "File selected: ",
      submitSuccess: "All requests submitted successfully!",
      submitFail: "Error",
      waiting: "Processing...",
      leaveInsufficient: "Annual leave balance insufficient! Your balance: ",
      pleaseEnterEmailName: "Please enter email and full name first.",
      staffNotRegistered: "Email not registered in system. Please contact HR.",
      deleteConfirm: "Delete this request? This cannot be undone.",
      deleteSuccess: "Deleted successfully",
      deleteError: "Delete failed",
      adminBtnText: "HR/Manager Access",
      pleaseWait: "Please wait, processing...",
      selectFile: "Select a file"
    }
  };
  
  // ========== FUNCTIONS ==========
  
  function applyUILanguage() {
    const t = translations[currentLang];
    document.getElementById('subtitle').innerText = t.subtitle;
    document.getElementById('langText').innerText = t.langText;
    document.getElementById('modeText').innerText = t.modeText;
    document.getElementById('tabRequest').innerHTML = t.tabRequest;
    document.getElementById('tabChat').innerHTML = t.tabChat;
    document.getElementById('tabHistory').innerHTML = t.tabHistory;
    document.getElementById('tabCalendar').innerHTML = t.tabCalendar;
    document.getElementById('staffInfoTitle').innerText = t.staffInfoTitle;
    document.getElementById('emailLabel').innerText = t.emailLabel;
    document.getElementById('nameLabel').innerText = t.nameLabel;
    document.getElementById('addRequestTitle').innerText = t.addRequestTitle;
    document.querySelector('label[for="receiptFile"]')?.innerText = t.selectFile || 'Select a file';
    
    const leaveSpan = document.querySelector('#leaveBadge span');
    if (leaveSpan) leaveSpan.innerText = t.leaveBadge;
    const otSpan = document.querySelector('#otBadge span');
    if (otSpan) otSpan.innerText = t.otBadge;
    const claimSpan = document.querySelector('#claimBadge span');
    if (claimSpan) claimSpan.innerText = t.claimBadge;
    
    document.getElementById('attachReceiptTitle').innerText = t.attachReceiptTitle;
    document.getElementById('uploadBtnText').innerText = t.uploadBtnText;
    document.getElementById('requestListTitle').innerHTML = t.requestListTitle;
    document.getElementById('calendarTitle').innerText = t.calendarTitle;
    document.getElementById('calendarMonthLabel').innerText = t.calendarMonthLabel;
    
    if (requests.length === 0) {
      const emptyDiv = document.getElementById('emptyMsg');
      if (emptyDiv) emptyDiv.innerText = t.emptyMsg;
    }
    document.getElementById('submitAllText').innerText = t.submitAllText;
    document.getElementById('assistantTitle').innerText = t.assistantTitle;
    document.getElementById('welcomeMsg').innerText = t.welcomeMsg;
    document.getElementById('sendBtnText').innerText = t.sendBtnText;
    document.getElementById('historyTitle').innerText = t.historyTitle;
    document.getElementById('loadBtnText').innerText = t.loadBtnText;
    document.getElementById('chatEmail').placeholder = t.emailLabel.split(' ')[1] || 'Email';
    document.getElementById('chatInput').placeholder = t.sendBtnText === 'Send' ? 'Type your question...' : 'Taip soalan...';
    document.getElementById('historyEmail').placeholder = t.emailLabel.split(' ')[1] || 'Email';
    document.getElementById('receiptDesc').placeholder = t.sendBtnText === 'Send' ? 'Description (e.g., Dinner)' : 'Keterangan (cth: Makan malam)';
    if (adminBtnSpan) adminBtnSpan.innerText = t.adminBtnText;
    
    // Reload calendar if visible
    const calendarTab = document.getElementById('calendar-tab');
    if (calendarTab.style.display !== 'none') {
      setTimeout(loadCalendar, 100);
    }
  }
  
  // Dark mode
  if (localStorage.getItem('versafac_mode') === 'dark') body.classList.add('dark');
  modeToggle.onclick = () => {
    body.classList.toggle('dark');
    localStorage.setItem('versafac_mode', body.classList.contains('dark') ? 'dark' : 'light');
  };
  
  // Language toggle
  langToggle.onclick = () => {
    currentLang = currentLang === 'ms' ? 'en' : 'ms';
    applyUILanguage();
  };
  
  async function checkStaffAndBalance(email) {
    try {
      const res = await fetch('/api/check-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      return { valid: data.valid === true, balance: data.balance || 0 };
    } catch(e) {
      return { valid: false, balance: 0 };
    }
  }
  
  async function validateBeforeAction() {
    const email = reqEmail.value.trim();
    const name = reqName.value.trim();
    if (!email || !name) {
      alert(translations[currentLang].pleaseEnterEmailName);
      return false;
    }
    const { valid, balance } = await checkStaffAndBalance(email);
    if (!valid) {
      alert(translations[currentLang].staffNotRegistered);
      return false;
    }
    currentBalance = balance;
    return true;
  }
  
  function formatClaimDetail(it) {
    if (it.claimType === 'Distance') return '🚗 ' + (it.from || '?') + ' → ' + (it.to || '?') + ' (' + (it.km || 0) + ' km) = RM' + it.amount.toFixed(2);
    if (it.claimType === 'Hotel') return '🏨 ' + (it.checkIn || '?') + ' → ' + (it.checkOut || '?') + ' = RM' + it.amount.toFixed(2);
    if (it.claimType === 'Meal') return '🍽️ Meal = RM' + it.amount.toFixed(2);
    if (it.claimType === 'Touch n Go') return '💳 Touch n Go = RM' + it.amount.toFixed(2);
    return '📦 Item: ' + (it.itemDesc || '') + ' = RM' + it.amount.toFixed(2);
  }
  
  function renderRequests() {
    const t = translations[currentLang];
    if (!requests.length) {
      requestsContainer.innerHTML = '<div style="text-align:center; padding:30px;" id="emptyMsg">' + t.emptyMsg + '</div>';
      document.getElementById('reqCount').innerText = '(0)';
      return;
    }
    let html = '';
    for (let r of requests) {
      if (r.type === 'leave') {
        html += '<div class="request-item"><div class="request-details"><i class="fas fa-calendar-week"></i> <strong>' + t.leaveBadge + '</strong> ' + r.leaveType + ' (' + r.halfDay + ')<br>' + r.startDate + ' → ' + r.endDate + '</div><div><button class="edit-req btn-icon" data-id="' + r.id + '"><i class="fas fa-edit"></i></button><button class="remove-req btn-icon" data-id="' + r.id + '"><i class="fas fa-trash"></i></button></div></div>';
      } else if (r.type === 'ot') {
        html += '<div class="request-item"><div class="request-details"><i class="fas fa-stopwatch"></i> <strong>' + t.otBadge + '</strong> ' + r.hours + 'h = RM' + r.amount.toFixed(2) + '<br>' + r.startDateTime + ' → ' + r.endDateTime + '<br>📍 ' + (r.site || '-') + '</div><div><button class="edit-req btn-icon" data-id="' + r.id + '"><i class="fas fa-edit"></i></button><button class="remove-req btn-icon" data-id="' + r.id + '"><i class="fas fa-trash"></i></button></div></div>';
      } else if (r.type === 'claim') {
        let itemsHtml = '';
        for (let it of r.items) itemsHtml += '<div class="claim-detail">' + formatClaimDetail(it) + '</div>';
        html += '<div class="request-item"><div class="request-details"><i class="fas fa-receipt"></i> <strong>' + t.claimBadge + '</strong> (Date: ' + r.claimDate + ')<br>' + itemsHtml + '</div><div><button class="edit-req btn-icon" data-id="' + r.id + '"><i class="fas fa-edit"></i></button><button class="remove-req btn-icon" data-id="' + r.id + '"><i class="fas fa-trash"></i></button></div></div>';
      }
    }
    requestsContainer.innerHTML = html;
    document.getElementById('reqCount').innerText = '(' + requests.length + ')';
    
    document.querySelectorAll('.remove-req').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(btn.dataset.id);
        requests = requests.filter(r => r.id !== id);
        renderRequests();
      });
    });
    
    document.querySelectorAll('.edit-req').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(btn.dataset.id);
        const req = requests.find(r => r.id === id);
        if (req) openEditModalForLocal(req);
      });
    });
  }
  
  function calculateLeaveDaysFront(startDate, endDate, halfDay) {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  const diffTime = Math.abs(end - start);
  let days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  if (halfDay !== 'full') days = days - 0.5;
  return days > 0 ? days : 0;
}
  
  // ========== LEAVE CALENDAR ==========
  async function loadCalendar() {
    const monthInput = document.getElementById('calendarMonth');
    if (!monthInput || !monthInput.value) return;
    
    const [year, month] = monthInput.value.split('-');
    const calendarView = document.getElementById('calendarView');
    const t = translations[currentLang];
    
    try {
      const res = await fetch('/api/get-leave-calendar?year=' + year + '&month=' + month);
      const data = await res.json();
      
      if (!data.success) {
        calendarView.innerHTML = '<p>' + t.calendarError + '</p>';
        return;
      }
      
      const daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate();
      const firstDay = new Date(parseInt(year), parseInt(month) - 1, 1).getDay();
      
      const weekdays = currentLang === 'ms' 
        ? ['Ahd', 'Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab']
        : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      
      const monthNames = currentLang === 'ms'
        ? ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember']
        : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      
      const table = document.createElement('table');
      table.style.width = '100%';
      table.style.borderCollapse = 'collapse';
      table.style.background = 'white';
      table.style.borderRadius = '16px';
      
      const caption = document.createElement('caption');
      caption.textContent = monthNames[parseInt(month) - 1] + ' ' + year;
      caption.style.fontSize = '1.2rem';
      caption.style.fontWeight = 'bold';
      caption.style.padding = '12px';
      caption.style.background = '#00aa6e';
      caption.style.color = 'white';
      caption.style.borderRadius = '16px 16px 0 0';
      table.appendChild(caption);
      
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      headerRow.style.background = '#f0f4f8';
      
      for (let w of weekdays) {
        const th = document.createElement('th');
        th.style.padding = '12px';
        th.style.border = '1px solid #ddd';
        th.style.textAlign = 'center';
        th.style.fontWeight = '600';
        th.textContent = w;
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);
      
      const tbody = document.createElement('tbody');
      let currentRow = document.createElement('tr');
      
      for (let i = 0; i < firstDay; i++) {
        const td = document.createElement('td');
        td.style.padding = '8px';
        td.style.border = '1px solid #ddd';
        td.style.verticalAlign = 'top';
        td.style.height = '80px';
        td.style.background = '#f9f9f9';
        td.innerHTML = '&nbsp;';
        currentRow.appendChild(td);
      }
      
      const leaveTypeMap = {
        'Annual': currentLang === 'ms' ? 'Tahunan' : 'Annual',
        'Sick': currentLang === 'ms' ? 'Sakit' : 'Sick',
        'Unpaid': currentLang === 'ms' ? 'Tanpa Gaji' : 'Unpaid',
        'Maternity': currentLang === 'ms' ? 'Bersalin' : 'Maternity',
        'Marriage': currentLang === 'ms' ? 'Kahwin' : 'Marriage',
        'Paternal': currentLang === 'ms' ? 'Bapa' : 'Paternal',
        'Compassionate': currentLang === 'ms' ? 'Kemalangan' : 'Compassionate'
      };
      
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        
        const td = document.createElement('td');
        td.style.padding = '8px';
        td.style.border = '1px solid #ddd';
        td.style.verticalAlign = 'top';
        td.style.height = '80px';
        
        const dateDiv = document.createElement('div');
        dateDiv.style.fontWeight = 'bold';
        dateDiv.style.marginBottom = '4px';
        dateDiv.textContent = d;
        td.appendChild(dateDiv);
        
        const leavesOnDay = data.leaves.filter(function(l) {
          return l.start <= dateStr && l.end >= dateStr;
        });
        
        for (let leave of leavesOnDay) {
          const leaveDiv = document.createElement('div');
          leaveDiv.style.background = '#00aa6e20';
          leaveDiv.style.borderRadius = '8px';
          leaveDiv.style.padding = '4px';
          leaveDiv.style.margin = '2px 0';
          leaveDiv.style.fontSize = '11px';
          leaveDiv.innerHTML = '<strong>' + escapeHtml(leave.name) + '</strong><br>' + (leaveTypeMap[leave.type] || leave.type);
          td.appendChild(leaveDiv);
        }
        
        currentRow.appendChild(td);
        
        if ((firstDay + d) % 7 === 0 && d !== daysInMonth) {
          tbody.appendChild(currentRow);
          currentRow = document.createElement('tr');
        }
      }
      
      const remaining = 7 - ((firstDay + daysInMonth) % 7);
      if (remaining < 7) {
        for (let i = 0; i < remaining; i++) {
          const td = document.createElement('td');
          td.style.padding = '8px';
          td.style.border = '1px solid #ddd';
          td.style.background = '#f9f9f9';
          td.innerHTML = '&nbsp;';
          currentRow.appendChild(td);
        }
      }
      
      tbody.appendChild(currentRow);
      table.appendChild(tbody);
      
      calendarView.innerHTML = '';
      calendarView.appendChild(table);
      
    } catch (e) {
      calendarView.innerHTML = '<p>Error: ' + e.message + '</p>';
    }
  }
  
  // Helper function for calendar
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
      if (m === '&') return '&amp;';
      if (m === '<') return '&lt;';
      if (m === '>') return '&gt;';
      return m;
    });
  }
  
  // ========== MODAL FUNCTIONS ==========
 function openEditModalForLocal(req) {
  if (isModalOpen) {
    alert(translations[currentLang].pleaseWait);
    return;
  }
  isModalOpen = true;
  
  const modalDiv = document.createElement('div');
  modalDiv.className = 'modal-overlay';
  let inner = '';
  
  if (req.type === 'leave') {
    inner = '<h3>✏️ ' + (currentLang === 'ms' ? 'Edit Cuti' : 'Edit Leave') + '</h3>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Jenis Cuti' : 'Leave Type') + '</label><select id="editLeaveType">' +
      '<option value="Annual" ' + (req.leaveType === 'Annual' ? 'selected' : '') + '>Annual</option>' +
      '<option value="Sick" ' + (req.leaveType === 'Sick' ? 'selected' : '') + '>Sick</option>' +
      '<option value="Unpaid" ' + (req.leaveType === 'Unpaid' ? 'selected' : '') + '>Unpaid</option>' +
      '<option value="Maternity" ' + (req.leaveType === 'Maternity' ? 'selected' : '') + '>Maternity</option>' +
      '<option value="Marriage" ' + (req.leaveType === 'Marriage' ? 'selected' : '') + '>Marriage</option>' +
      '<option value="Paternal" ' + (req.leaveType === 'Paternal' ? 'selected' : '') + '>Paternal</option>' +
      '<option value="Compassionate" ' + (req.leaveType === 'Compassionate' ? 'selected' : '') + '>Compassionate</option>' +
      '</select></div>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Separuh hari' : 'Half day') + '</label><select id="editHalf">' +
      '<option value="full" ' + (req.halfDay === 'full' ? 'selected' : '') + '>' + (currentLang === 'ms' ? 'Penuh' : 'Full') + '</option>' +
      '<option value="morning" ' + (req.halfDay === 'morning' ? 'selected' : '') + '>' + (currentLang === 'ms' ? 'Pagi' : 'Morning') + '</option>' +
      '<option value="afternoon" ' + (req.halfDay === 'afternoon' ? 'selected' : '') + '>' + (currentLang === 'ms' ? 'Petang' : 'Afternoon') + '</option>' +
      '</select></div>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Tarikh Mula' : 'Start Date') + '</label><input type="date" id="editStart" value="' + req.startDate + '"></div>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Tarikh Akhir' : 'End Date') + '</label><input type="date" id="editEnd" value="' + req.endDate + '"></div>' +
      '<div id="dateError" class="error-msg"></div>';
  } else if (req.type === 'ot') {
    inner = '<h3>✏️ ' + (currentLang === 'ms' ? 'Edit Lebih Masa' : 'Edit Overtime') + '</h3>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Mula' : 'Start') + '</label><input type="datetime-local" id="editStartDT" value="' + req.startDateTime + '"></div>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Tamat' : 'End') + '</label><input type="datetime-local" id="editEndDT" value="' + req.endDateTime + '"></div>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Jam' : 'Hours') + '</label><input type="number" step="0.5" id="editHours" value="' + req.hours + '"></div>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Jumlah (RM)' : 'Amount (RM)') + '</label><input type="number" step="0.01" id="editAmount" value="' + req.amount.toFixed(2) + '"></div>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Lokasi' : 'Location') + '</label><input id="editSite" value="' + (req.site || '') + '"></div>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Keterangan' : 'Description') + '</label><textarea id="editDesc" rows="2">' + (req.description || '') + '</textarea></div>';
  } else if (req.type === 'claim') {
    inner = '<h3>✏️ ' + (currentLang === 'ms' ? 'Edit Tuntutan' : 'Edit Claim') + '</h3>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Tarikh Tuntutan' : 'Claim Date') + '</label><input type="date" id="editClaimDate" value="' + req.claimDate + '"></div>' +
      '<div id="editClaimItemsList"></div>' +
      '<button type="button" id="addEditClaimItem" class="btn-icon">+ ' + (currentLang === 'ms' ? 'Tambah Item' : 'Add Item') + '</button>';
  }
  
  modalDiv.innerHTML = '<div class="modal-content"><div style="text-align:right"><button class="closeModal" style="background:none;font-size:24px;">&times;</button></div>' + inner + '<div style="display:flex;gap:12px;margin-top:20px;"><button id="saveEditBtn">' + (currentLang === 'ms' ? 'Simpan' : 'Save') + '</button><button id="cancelEditBtn">' + (currentLang === 'ms' ? 'Batal' : 'Cancel') + '</button></div></div>';
  document.body.appendChild(modalDiv);
  
  const closeModalHandler = () => {
    if (document.body.contains(modalDiv)) document.body.removeChild(modalDiv);
    isModalOpen = false;
  };
  
  if (req.type === 'claim') {
    let claimItems = [...req.items];
    
    function renderEditClaimItems() {
      const container = document.getElementById('editClaimItemsList');
      if (!container) return;
      container.innerHTML = '';
      let html = '';
      for (let idx = 0; idx < claimItems.length; idx++) {
        const it = claimItems[idx];
        html += '<div style="margin-bottom:16px;border-left:3px solid #00cc88;padding:10px;border-radius:12px;" data-edit-item-index="' + idx + '">';
        html += '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Jenis Tuntutan' : 'Claim Type') + '</label>' +
          '<select class="editClaimTypeSelect" data-idx="' + idx + '">' +
          '<option value="Meal" ' + (it.claimType === 'Meal' ? 'selected' : '') + '>🍽️ Meal</option>' +
          '<option value="Touch n Go" ' + (it.claimType === 'Touch n Go' ? 'selected' : '') + '>💳 Touch n Go</option>' +
          '<option value="Distance" ' + (it.claimType === 'Distance' ? 'selected' : '') + '>🚗 Distance</option>' +
          '<option value="Hotel" ' + (it.claimType === 'Hotel' ? 'selected' : '') + '>🏨 Hotel</option>' +
          '<option value="Item" ' + (it.claimType === 'Item' ? 'selected' : '') + '>📦 Item</option>' +
          '</select></div>';
        
        html += '<div class="editDistFields" style="display:none;">' +
          '<div class="form-group"><label>Dari</label><input type="text" class="editDistFrom" data-idx="' + idx + '" value="' + (it.from || '') + '"></div>' +
          '<div class="form-group"><label>Ke</label><input type="text" class="editDistTo" data-idx="' + idx + '" value="' + (it.to || '') + '"></div>' +
          '<div class="form-group"><label>Jarak (km)</label><input type="number" step="0.1" class="editDistKm" data-idx="' + idx + '" value="' + (it.km || '') + '"></div>' +
          '<div class="form-group"><label>Jumlah (RM)</label><input type="text" class="editDistAmount" data-idx="' + idx + '" readonly value="' + (it.amount ? it.amount.toFixed(2) : '0') + '"></div></div>';
        
        html += '<div class="editHotelFields" style="display:none;">' +
          '<div class="form-group"><label>Check-in</label><input type="date" class="editHotelIn" data-idx="' + idx + '" value="' + (it.checkIn || '') + '"></div>' +
          '<div class="form-group"><label>Check-out</label><input type="date" class="editHotelOut" data-idx="' + idx + '" value="' + (it.checkOut || '') + '"></div>' +
          '<div class="form-group"><label>Jumlah (RM)</label><input type="number" step="0.01" class="editHotelAmount" data-idx="' + idx + '" value="' + (it.amount || '') + '"></div></div>';
        
        html += '<div class="editMealFields" style="display:none;">' +
          '<div class="form-group"><label>Jumlah (RM)</label><input type="number" step="0.01" class="editMealAmount" data-idx="' + idx + '" value="' + (it.amount || '') + '"></div></div>';
        
        html += '<div class="editTngFields" style="display:none;">' +
          '<div class="form-group"><label>Jumlah (RM)</label><input type="number" step="0.01" class="editTngAmount" data-idx="' + idx + '" value="' + (it.amount || '') + '"></div></div>';
        
        html += '<div class="editOthersFields" style="display:none;">' +
          '<div class="form-group"><label>Keterangan</label><input type="text" class="editOthersDesc" data-idx="' + idx + '" value="' + (it.itemDesc || '') + '"></div>' +
          '<div class="form-group"><label>Jumlah (RM)</label><input type="number" step="0.01" class="editOthersAmount" data-idx="' + idx + '" value="' + (it.amount || '') + '"></div></div>';
        
        html += '<button class="removeEditItem" data-idx="' + idx + '" style="background:#dc3545; color:white; border:none; padding:4px 10px; border-radius:20px; margin-top:8px;">' + (currentLang === 'ms' ? 'Buang' : 'Remove') + '</button>';
        html += '<hr></div>';
      }
      container.innerHTML = html;
      
      for (let i = 0; i < claimItems.length; i++) {
        attachEditClaimEvents(i);
      }
      
      document.querySelectorAll('.removeEditItem').forEach(btn => {
        btn.addEventListener('click', (e) => {
          let idx = parseInt(btn.dataset.idx);
          claimItems.splice(idx, 1);
          renderEditClaimItems();
        });
      });
    }
    
    function attachEditClaimEvents(idx) {
      const typeSel = document.querySelector('.editClaimTypeSelect[data-idx="' + idx + '"]');
      const container = document.querySelector('[data-edit-item-index="' + idx + '"]');
      if (!container) return;
      
      const distDiv = container.querySelector('.editDistFields');
      const hotelDiv = container.querySelector('.editHotelFields');
      const mealDiv = container.querySelector('.editMealFields');
      const tngDiv = container.querySelector('.editTngFields');
      const othersDiv = container.querySelector('.editOthersFields');
      
      function toggle() {
        const val = typeSel.value;
        if (distDiv) distDiv.style.display = val === 'Distance' ? 'block' : 'none';
        if (hotelDiv) hotelDiv.style.display = val === 'Hotel' ? 'block' : 'none';
        if (mealDiv) mealDiv.style.display = val === 'Meal' ? 'block' : 'none';
        if (tngDiv) tngDiv.style.display = val === 'Touch n Go' ? 'block' : 'none';
        if (othersDiv) othersDiv.style.display = val === 'Item' ? 'block' : 'none';
        claimItems[idx].claimType = val;
      }
      if (typeSel) {
        typeSel.addEventListener('change', toggle);
        toggle();
      }
      
      const kmInp = container.querySelector('.editDistKm');
      const distAmt = container.querySelector('.editDistAmount');
      if (kmInp && distAmt) {
        kmInp.addEventListener('input', async () => {
          let km = parseFloat(kmInp.value) || 0;
          let rate = 0.6;
          try {
            const res = await fetch('/api/get-settings');
            const settings = await res.json();
            rate = settings.distanceRate || 0.6;
          } catch(e) { rate = 0.6; }
          let amt = km * rate;
          distAmt.value = amt.toFixed(2);
          claimItems[idx].amount = amt;
          claimItems[idx].km = km;
        });
      }
      
      const fromInp = container.querySelector('.editDistFrom');
      const toInp = container.querySelector('.editDistTo');
      if (fromInp) fromInp.addEventListener('change', () => { claimItems[idx].from = fromInp.value; });
      if (toInp) toInp.addEventListener('change', () => { claimItems[idx].to = toInp.value; });
      
      const hotelIn = container.querySelector('.editHotelIn');
      const hotelOut = container.querySelector('.editHotelOut');
      const hotelAmt = container.querySelector('.editHotelAmount');
      if (hotelIn && hotelOut && hotelAmt) {
        const updateHotel = async () => {
          if (hotelIn.value && hotelOut.value) {
            let nights = Math.max(1, Math.round((new Date(hotelOut.value) - new Date(hotelIn.value)) / (1000 * 60 * 60 * 24)));
            let rate = 150;
            try {
              const res = await fetch('/api/get-settings');
              const settings = await res.json();
              rate = settings.hotelRate || 150;
            } catch(e) { rate = 150; }
            let amt = nights * rate;
            hotelAmt.value = amt;
            claimItems[idx].amount = amt;
            claimItems[idx].checkIn = hotelIn.value;
            claimItems[idx].checkOut = hotelOut.value;
          }
        };
        hotelIn.addEventListener('change', updateHotel);
        hotelOut.addEventListener('change', updateHotel);
        hotelAmt.addEventListener('input', () => { claimItems[idx].amount = parseFloat(hotelAmt.value) || 0; });
      }
      
      const mealAmt = container.querySelector('.editMealAmount');
      if (mealAmt) mealAmt.addEventListener('input', () => { claimItems[idx].amount = parseFloat(mealAmt.value) || 0; });
      
      const tngAmt = container.querySelector('.editTngAmount');
      if (tngAmt) tngAmt.addEventListener('input', () => { claimItems[idx].amount = parseFloat(tngAmt.value) || 0; });
      
      const othersAmt = container.querySelector('.editOthersAmount');
      const othersDesc = container.querySelector('.editOthersDesc');
      if (othersAmt) othersAmt.addEventListener('input', () => { claimItems[idx].amount = parseFloat(othersAmt.value) || 0; });
      if (othersDesc) othersDesc.addEventListener('input', () => { claimItems[idx].itemDesc = othersDesc.value; });
    }
    
    const addItemBtn = document.getElementById('addEditClaimItem');
    if (addItemBtn) {
      addItemBtn.onclick = () => {
        if (isAddingEditItem) return;
        isAddingEditItem = true;
        claimItems.push({ claimType: 'Meal', amount: 0 });
        renderEditClaimItems();
        setTimeout(() => { isAddingEditItem = false; }, 500);
      };
    }
    
    renderEditClaimItems();
    
    document.getElementById('saveEditBtn').onclick = () => {
      const newClaimDate = document.getElementById('editClaimDate').value;
      const validItems = claimItems.filter(i => i.amount > 0);
      if (validItems.length === 0) {
        alert(currentLang === 'ms' ? 'Sekurang-kurangnya satu item perlu ada jumlah' : 'At least one item must have an amount');
        return;
      }
      req.claimDate = newClaimDate;
      req.items = validItems;
      renderRequests();
      closeModalHandler();
    };
  } else if (req.type === 'leave') {
    document.getElementById('saveEditBtn').onclick = () => {
      req.leaveType = document.getElementById('editLeaveType').value;
      req.halfDay = document.getElementById('editHalf').value;
      req.startDate = document.getElementById('editStart').value;
      req.endDate = document.getElementById('editEnd').value;
      renderRequests();
      closeModalHandler();
    };
  } else if (req.type === 'ot') {
    document.getElementById('saveEditBtn').onclick = () => {
      req.startDateTime = document.getElementById('editStartDT').value;
      req.endDateTime = document.getElementById('editEndDT').value;
      req.hours = parseFloat(document.getElementById('editHours').value);
      req.amount = parseFloat(document.getElementById('editAmount').value);
      req.site = document.getElementById('editSite').value;
      req.description = document.getElementById('editDesc').value;
      renderRequests();
      closeModalHandler();
    };
  }
  
  modalDiv.querySelector('.closeModal').onclick = closeModalHandler;
  modalDiv.querySelector('#cancelEditBtn').onclick = closeModalHandler;
}
  
 async function showAddModal(type) {
  if (isModalOpen) {
    alert(translations[currentLang].pleaseWait);
    return;
  }
  
  const isValid = await validateBeforeAction();
  if (!isValid) return;
  
  isModalOpen = true;
  
  const modalDiv = document.createElement('div');
  modalDiv.className = 'modal-overlay';
  let inner = '';
  
  if (type === 'leave') {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const todayStr = today.toISOString().split('T')[0];
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    inner = '<h3>➕ ' + (currentLang === 'ms' ? 'Cuti Baru' : 'New Leave') + '</h3>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Jenis Cuti' : 'Leave Type') + '</label><select id="newLeaveType"><option>Annual</option><option>Sick</option><option>Unpaid</option><option>Maternity</option><option>Marriage</option><option>Paternal</option><option>Compassionate</option></select></div>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Separuh hari' : 'Half day') + '</label><select id="newHalf"><option value="full">' + (currentLang === 'ms' ? 'Penuh' : 'Full') + '</option><option value="morning">' + (currentLang === 'ms' ? 'Pagi' : 'Morning') + '</option><option value="afternoon">' + (currentLang === 'ms' ? 'Petang' : 'Afternoon') + '</option></select></div>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Tarikh Mula' : 'Start Date') + '</label><input type="date" id="newStart" value="' + todayStr + '"></div>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Tarikh Akhir' : 'End Date') + '</label><input type="date" id="newEnd" value="' + tomorrowStr + '"></div>' +
      '<div id="dateError" class="error-msg"></div>';
  } else if (type === 'ot') {
    inner = '<h3>➕ ' + (currentLang === 'ms' ? 'Lebih Masa Baru' : 'New Overtime') + '</h3>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Mula' : 'Start') + '</label><input type="datetime-local" id="newStartDT"></div>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Tamat' : 'End') + '</label><input type="datetime-local" id="newEndDT"></div>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Jam (auto)' : 'Hours (auto)') + '</label><input type="number" step="0.5" id="newHours"></div>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Jumlah (RM)' : 'Amount (RM)') + '</label><input type="number" step="0.01" id="newAmount"></div>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Lokasi' : 'Location') + '</label><input id="newSite"></div>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Keterangan' : 'Description') + '</label><textarea id="newDesc" rows="2"></textarea></div>';
  } else if (type === 'claim') {
    inner = '<h3>➕ ' + (currentLang === 'ms' ? 'Tuntutan Baru' : 'New Claim') + '</h3>' +
      '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Tarikh Tuntutan' : 'Claim Date') + '</label><input type="date" id="newClaimDate" value="' + new Date().toISOString().slice(0, 10) + '"></div>' +
      '<div id="newClaimItemsList"></div>' +
      '<button type="button" id="addNewClaimItem" class="btn-icon">+ ' + (currentLang === 'ms' ? 'Tambah Item' : 'Add Item') + '</button>';
  }
  
  modalDiv.innerHTML = '<div class="modal-content"><div style="text-align:right"><button class="closeModal" style="background:none;font-size:24px;">&times;</button></div>' + inner + '<div style="display:flex;gap:12px;margin-top:20px;"><button id="confirmAdd">' + (currentLang === 'ms' ? 'Tambah' : 'Add') + '</button><button id="cancelAdd">' + (currentLang === 'ms' ? 'Batal' : 'Cancel') + '</button></div></div>';
  document.body.appendChild(modalDiv);
  
  const closeModalHandler = () => {
    if (document.body.contains(modalDiv)) document.body.removeChild(modalDiv);
    isModalOpen = false;
  };
  
  // OT auto-calculate
  if (type === 'ot') {
    const start = document.getElementById('newStartDT');
    const end = document.getElementById('newEndDT');
    const hoursInp = document.getElementById('newHours');
    const amtInp = document.getElementById('newAmount');
    const update = () => {
      if (start.value && end.value) {
        let h = Math.round(((new Date(end.value) - new Date(start.value)) / 3600000) * 2) / 2;
        hoursInp.value = h;
        let rate = [15, 15, 15, 15, 15, 20, 25][new Date(start.value).getDay()];
        amtInp.value = (h * rate).toFixed(2);
      }
    };
    if (start) start.addEventListener('change', update);
    if (end) end.addEventListener('change', update);
  }
  
  // Claim items
  if (type === 'claim') {
    let claimItems = [];
    
    function renderClaimItems() {
      const container = document.getElementById('newClaimItemsList');
      if (!container) return;
      container.innerHTML = '';
      let html = '';
      for (let idx = 0; idx < claimItems.length; idx++) {
        const it = claimItems[idx];
        html += '<div style="margin-bottom:16px;border-left:3px solid #00cc88;padding:10px;border-radius:12px;" data-item-index="' + idx + '">';
        html += '<div class="form-group"><label>' + (currentLang === 'ms' ? 'Jenis Tuntutan' : 'Claim Type') + '</label>' +
          '<select class="claimTypeSelect" data-idx="' + idx + '">' +
          '<option value="Meal" ' + (it.claimType === 'Meal' ? 'selected' : '') + '>🍽️ Meal</option>' +
          '<option value="Touch n Go" ' + (it.claimType === 'Touch n Go' ? 'selected' : '') + '>💳 Touch n Go</option>' +
          '<option value="Distance" ' + (it.claimType === 'Distance' ? 'selected' : '') + '>🚗 Distance</option>' +
          '<option value="Hotel" ' + (it.claimType === 'Hotel' ? 'selected' : '') + '>🏨 Hotel</option>' +
          '<option value="Item" ' + (it.claimType === 'Item' ? 'selected' : '') + '>📦 Item</option>' +
          '</select></div>';
        
        html += '<div class="distFields" style="display:none;">' +
          '<div class="form-group"><label>Dari</label><input type="text" class="distFrom" data-idx="' + idx + '" value="' + (it.from || '') + '"></div>' +
          '<div class="form-group"><label>Ke</label><input type="text" class="distTo" data-idx="' + idx + '" value="' + (it.to || '') + '"></div>' +
          '<div class="form-group"><label>Jarak (km)</label><input type="number" step="0.1" class="distKm" data-idx="' + idx + '" value="' + (it.km || '') + '"></div>' +
          '<div class="form-group"><label>Jumlah (RM)</label><input type="text" class="distAmount" data-idx="' + idx + '" readonly value="' + (it.amount ? it.amount.toFixed(2) : '0') + '"></div></div>';
        
        html += '<div class="hotelFields" style="display:none;">' +
          '<div class="form-group"><label>Check-in</label><input type="date" class="hotelIn" data-idx="' + idx + '" value="' + (it.checkIn || '') + '"></div>' +
          '<div class="form-group"><label>Check-out</label><input type="date" class="hotelOut" data-idx="' + idx + '" value="' + (it.checkOut || '') + '"></div>' +
          '<div class="form-group"><label>Jumlah (RM)</label><input type="number" step="0.01" class="hotelAmount" data-idx="' + idx + '" value="' + (it.amount || '') + '"></div></div>';
        
        html += '<div class="mealFields" style="display:none;">' +
          '<div class="form-group"><label>Jumlah (RM)</label><input type="number" step="0.01" class="mealAmount" data-idx="' + idx + '" value="' + (it.amount || '') + '"></div></div>';
        
        html += '<div class="tngFields" style="display:none;">' +
          '<div class="form-group"><label>Jumlah (RM)</label><input type="number" step="0.01" class="tngAmount" data-idx="' + idx + '" value="' + (it.amount || '') + '"></div></div>';
        
        html += '<div class="othersFields" style="display:none;">' +
          '<div class="form-group"><label>Keterangan</label><input type="text" class="othersDesc" data-idx="' + idx + '" value="' + (it.itemDesc || '') + '"></div>' +
          '<div class="form-group"><label>Jumlah (RM)</label><input type="number" step="0.01" class="othersAmount" data-idx="' + idx + '" value="' + (it.amount || '') + '"></div></div>';
        
        html += '<button class="removeItem" data-idx="' + idx + '" style="background:#dc3545; color:white; border:none; padding:4px 10px; border-radius:20px; margin-top:8px;">' + (currentLang === 'ms' ? 'Buang' : 'Remove') + '</button>';
        html += '<hr></div>';
      }
      container.innerHTML = html;
      
      // Attach events for each claim item
      for (let i = 0; i < claimItems.length; i++) {
        attachClaimEvents(i);
      }
      
      document.querySelectorAll('.removeItem').forEach(btn => {
        btn.addEventListener('click', (e) => {
          let idx = parseInt(btn.dataset.idx);
          claimItems.splice(idx, 1);
          renderClaimItems();
        });
      });
    }
    
    function attachClaimEvents(idx) {
      const typeSel = document.querySelector('.claimTypeSelect[data-idx="' + idx + '"]');
      const container = document.querySelector('[data-item-index="' + idx + '"]');
      if (!container) return;
      
      const distDiv = container.querySelector('.distFields');
      const hotelDiv = container.querySelector('.hotelFields');
      const mealDiv = container.querySelector('.mealFields');
      const tngDiv = container.querySelector('.tngFields');
      const othersDiv = container.querySelector('.othersFields');
      
      function toggle() {
        const val = typeSel.value;
        if (distDiv) distDiv.style.display = val === 'Distance' ? 'block' : 'none';
        if (hotelDiv) hotelDiv.style.display = val === 'Hotel' ? 'block' : 'none';
        if (mealDiv) mealDiv.style.display = val === 'Meal' ? 'block' : 'none';
        if (tngDiv) tngDiv.style.display = val === 'Touch n Go' ? 'block' : 'none';
        if (othersDiv) othersDiv.style.display = val === 'Item' ? 'block' : 'none';
        claimItems[idx].claimType = val;
      }
      if (typeSel) {
        typeSel.addEventListener('change', toggle);
        toggle();
      }
      
      const kmInp = container.querySelector('.distKm');
      const distAmt = container.querySelector('.distAmount');
      if (kmInp && distAmt) {
        kmInp.addEventListener('input', async () => {
          let km = parseFloat(kmInp.value) || 0;
          let rate = 0.6;
          try {
            const res = await fetch('/api/get-settings');
            const settings = await res.json();
            rate = settings.distanceRate || 0.6;
          } catch(e) { rate = 0.6; }
          let amt = km * rate;
          distAmt.value = amt.toFixed(2);
          claimItems[idx].amount = amt;
          claimItems[idx].km = km;
        });
      }
      
      const fromInp = container.querySelector('.distFrom');
      const toInp = container.querySelector('.distTo');
      if (fromInp) fromInp.addEventListener('change', () => { claimItems[idx].from = fromInp.value; });
      if (toInp) toInp.addEventListener('change', () => { claimItems[idx].to = toInp.value; });
      
      const hotelIn = container.querySelector('.hotelIn');
      const hotelOut = container.querySelector('.hotelOut');
      const hotelAmt = container.querySelector('.hotelAmount');
      if (hotelIn && hotelOut && hotelAmt) {
        const updateHotel = async () => {
          if (hotelIn.value && hotelOut.value) {
            let nights = Math.max(1, Math.round((new Date(hotelOut.value) - new Date(hotelIn.value)) / (1000 * 60 * 60 * 24)));
            let rate = 150;
            try {
              const res = await fetch('/api/get-settings');
              const settings = await res.json();
              rate = settings.hotelRate || 150;
            } catch(e) { rate = 150; }
            let amt = nights * rate;
            hotelAmt.value = amt;
            claimItems[idx].amount = amt;
            claimItems[idx].checkIn = hotelIn.value;
            claimItems[idx].checkOut = hotelOut.value;
          }
        };
        hotelIn.addEventListener('change', updateHotel);
        hotelOut.addEventListener('change', updateHotel);
        hotelAmt.addEventListener('input', () => { claimItems[idx].amount = parseFloat(hotelAmt.value) || 0; });
      }
      
      const mealAmt = container.querySelector('.mealAmount');
      if (mealAmt) mealAmt.addEventListener('input', () => { claimItems[idx].amount = parseFloat(mealAmt.value) || 0; });
      
      const tngAmt = container.querySelector('.tngAmount');
      if (tngAmt) tngAmt.addEventListener('input', () => { claimItems[idx].amount = parseFloat(tngAmt.value) || 0; });
      
      const othersAmt = container.querySelector('.othersAmount');
      const othersDesc = container.querySelector('.othersDesc');
      if (othersAmt) othersAmt.addEventListener('input', () => { claimItems[idx].amount = parseFloat(othersAmt.value) || 0; });
      if (othersDesc) othersDesc.addEventListener('input', () => { claimItems[idx].itemDesc = othersDesc.value; });
    }
    
    const addItemBtn = document.getElementById('addNewClaimItem');
    if (addItemBtn) {
      addItemBtn.onclick = () => {
        if (isAddingItem) return;
        isAddingItem = true;
        claimItems.push({ claimType: 'Meal', amount: 0 });
        renderClaimItems();
        setTimeout(() => { isAddingItem = false; }, 500);
      };
    }
    
    renderClaimItems();
    
    const confirmBtn = modalDiv.querySelector('#confirmAdd');
    if (confirmBtn) {
      confirmBtn.onclick = () => {
        if (isConfirming) return;
        isConfirming = true;
        
        const claimDate = document.getElementById('newClaimDate').value;
        const validItems = claimItems.filter(i => i.amount > 0);
        if (validItems.length === 0) {
          alert(currentLang === 'ms' ? 'Tambah sekurang-kurangnya satu item' : 'Add at least one item');
          isConfirming = false;
          return;
        }
        requests.push({ id: nextId++, type: 'claim', claimDate: claimDate, items: validItems });
        renderRequests();
        closeModalHandler();
        isConfirming = false;
      };
    }
  } else if (type === 'leave') {
    const confirmBtn = modalDiv.querySelector('#confirmAdd');
    if (confirmBtn) {
      confirmBtn.onclick = async () => {
        if (isConfirming) return;
        isConfirming = true;
        
        const lt = document.getElementById('newLeaveType').value;
        const hd = document.getElementById('newHalf').value;
        const startInput = document.getElementById('newStart');
        const endInput = document.getElementById('newEnd');
        const errorSpan = document.getElementById('dateError');
        
        let startDate = startInput.value ? new Date(startInput.value) : null;
        let endDate = endInput.value ? new Date(endInput.value) : null;
        
        if (!startDate || !endDate || isNaN(startDate) || isNaN(endDate)) {
          errorSpan.innerText = currentLang === 'ms' ? 'Sila pilih tarikh yang sah menggunakan kalendar.' : 'Please select valid dates using the calendar.';
          isConfirming = false;
          return;
        }
        if (endDate < startDate) {
          errorSpan.innerText = currentLang === 'ms' ? 'Tarikh akhir mestilah selepas tarikh mula.' : 'End date must be after start date.';
          isConfirming = false;
          return;
        }
        const sdStr = startDate.toISOString().split('T')[0];
        const edStr = endDate.toISOString().split('T')[0];
        const daysReq = calculateLeaveDaysFront(sdStr, edStr, hd);
        if (daysReq > currentBalance) {
          errorSpan.innerText = translations[currentLang].leaveInsufficient + currentBalance + ' ' + (currentLang === 'ms' ? 'hari. Permohonan anda: ' : 'days. Requested: ') + daysReq + ' ' + (currentLang === 'ms' ? 'hari.' : 'days.');
          isConfirming = false;
          return;
        }
        requests.push({ id: nextId++, type: 'leave', leaveType: lt, halfDay: hd, startDate: sdStr, endDate: edStr });
        renderRequests();
        closeModalHandler();
        isConfirming = false;
      };
    }
  } else if (type === 'ot') {
    const confirmBtn = modalDiv.querySelector('#confirmAdd');
    if (confirmBtn) {
      confirmBtn.onclick = () => {
        if (isConfirming) return;
        isConfirming = true;
        
        const sdt = document.getElementById('newStartDT').value;
        const edt = document.getElementById('newEndDT').value;
        const hrs = parseFloat(document.getElementById('newHours').value);
        const amt = parseFloat(document.getElementById('newAmount').value);
        const site = document.getElementById('newSite').value;
        const desc = document.getElementById('newDesc').value;
        if (!sdt || !edt) {
          alert(currentLang === 'ms' ? 'Pilih masa' : 'Select datetime');
          isConfirming = false;
          return;
        }
        requests.push({ id: nextId++, type: 'ot', startDateTime: sdt, endDateTime: edt, hours: hrs, amount: amt, site: site, description: desc });
        renderRequests();
        closeModalHandler();
        isConfirming = false;
      };
    }
  }
  
  modalDiv.querySelector('.closeModal').onclick = closeModalHandler;
  modalDiv.querySelector('#cancelAdd').onclick = closeModalHandler;
}
  
  
  // ========== EVENT LISTENERS ==========
  
  document.querySelectorAll('.badge-add').forEach(b => {
    b.addEventListener('click', async (e) => {
      if (isBadgeClicking) return;
      isBadgeClicking = true;
      await showAddModal(b.dataset.type);
      setTimeout(() => { isBadgeClicking = false; }, 1000);
    });
  });
  
  submitAllBtn.onclick = async () => {
  if (isSubmitting) {
    alert(translations[currentLang].pleaseWait);
    return;
  }
  
  const email = reqEmail.value.trim();
  const name = reqName.value.trim();
  
  if (!email || !name) {
    alert(translations[currentLang].pleaseEnterEmailName);
    return;
  }
  
  if (requests.length === 0) {
    alert(currentLang === 'ms' ? 'Tiada permohonan' : 'No requests');
    return;
  }
  
  isSubmitting = true;
  submitAllBtn.disabled = true;
  submitAllBtn.style.opacity = '0.6';
  
  const t = translations[currentLang];
  submitResultDiv.style.display = 'block';
  submitResultDiv.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> ' + t.waiting;
  
  try {
    for (let it of requests) {
      if (it.type === 'leave') {
        await fetch('/api/submit-leave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email, name,
            leaveType: it.leaveType,
            halfDay: it.halfDay,
            startDate: it.startDate,
            endDate: it.endDate
          })
        });
      } else if (it.type === 'ot') {
        await fetch('/api/submit-overtime', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email, fullName: name,
            startDateTime: it.startDateTime,
            endDateTime: it.endDateTime,
            hours: it.hours,
            amount: it.amount,
            site: it.site,
            description: it.description || ''
          })
        });
      } else if (it.type === 'claim') {
        await fetch('/api/submit-claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email, fullName: name,
            claimDate: it.claimDate,
            items: it.items
          })
        });
      }
    }
    submitResultDiv.innerHTML = '<i class="fas fa-check-circle"></i> ' + t.submitSuccess;
    requests = [];
    renderRequests();
  } catch (err) {
    submitResultDiv.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + t.submitFail + ': ' + err.message;
  } finally {
    isSubmitting = false;
    submitAllBtn.disabled = false;
    submitAllBtn.style.opacity = '1';
    setTimeout(() => {
      submitResultDiv.style.display = 'none';
    }, 3000);
  }
};
  
  uploadBtn.onclick = async () => {
  if (isUploading) {
    alert(translations[currentLang].pleaseWait);
    return;
  }
  
  const email = reqEmail.value.trim();
  const name = reqName.value.trim();
  
  if (!email || !name) {
    alert(translations[currentLang].pleaseEnterEmailName);
    return;
  }
  
  const file = fileInput.files[0];
  if (!file) {
    alert(currentLang === 'ms' ? 'Pilih fail' : 'Select a file');
    return;
  }
  
  isUploading = true;
  uploadBtn.disabled = true;
  uploadBtn.style.opacity = '0.6';
  
  const t = translations[currentLang];
  uploadFeedback.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> ' + t.waiting;
  
  const fd = new FormData();
  fd.append('email', email);
  fd.append('fullName', name);
  fd.append('receiptType', document.getElementById('receiptType').value);
  fd.append('description', document.getElementById('receiptDesc').value);
  fd.append('file', file);
  
  try {
    const resp = await fetch('/api/upload-receipt', { method: 'POST', body: fd });
    const data = await resp.json();
    if (data.success) {
      uploadFeedback.innerHTML = '<i class="fas fa-check-circle"></i> ' + t.uploadOk + ' (' + file.name + ')';
      fileInput.value = '';
      document.getElementById('receiptDesc').value = '';
    } else {
      uploadFeedback.innerHTML = '<i class="fas fa-times"></i> ' + data.error;
    }
  } catch (e) {
    uploadFeedback.innerHTML = '<i class="fas fa-times"></i> ' + t.uploadFail;
  } finally {
    isUploading = false;
    uploadBtn.disabled = false;
    uploadBtn.style.opacity = '1';
    setTimeout(() => {
      uploadFeedback.innerHTML = '';
    }, 3000);
  }
};
  
  sendChatBtn.onclick = async () => {
  if (isSending) return;
  
  const email = document.getElementById('chatEmail').value.trim();
  const msg = document.getElementById('chatInput').value.trim();
  
  if (!email || !msg) {
    alert(currentLang === 'ms' ? 'Email dan soalan diperlukan' : 'Email and message required');
    return;
  }
  
  isSending = true;
  sendChatBtn.disabled = true;
  sendChatBtn.style.opacity = '0.6';
  
  const chatBox = document.getElementById('chatBox');
  const userDiv = document.createElement('div');
  userDiv.className = 'msg-user';
  userDiv.innerText = msg;
  chatBox.appendChild(userDiv);
  document.getElementById('chatInput').value = '';
  
  const loading = document.createElement('div');
  loading.className = 'msg-ai';
  loading.innerText = '...';
  chatBox.appendChild(loading);
  
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, email: email, language: currentLang })
    });
    const data = await res.json();
    loading.innerText = data.reply || (currentLang === 'ms' ? 'Ralat' : 'Error');
  } catch (e) {
    loading.innerText = currentLang === 'ms' ? 'Ralat rangkaian' : 'Network error';
  }
  
  chatBox.scrollTop = chatBox.scrollHeight;
  isSending = false;
  sendChatBtn.disabled = false;
  sendChatBtn.style.opacity = '1';
};
  
  loadHistoryBtn.onclick = async () => {
  if (isLoading) return;
  
  const email = document.getElementById('historyEmail').value;
  if (!email) return;
  
  isLoading = true;
  loadHistoryBtn.disabled = true;
  loadHistoryBtn.style.opacity = '0.6';
  
  try {
    const res = await fetch('/api/get-history?email=' + encodeURIComponent(email));
    const data = await res.json();
    const historyDiv = document.getElementById('historyList');
    
    if (!data.success) {
      historyDiv.innerHTML = '<p>' + (currentLang === 'ms' ? 'Ralat memuat sejarah' : 'Error loading history') + '</p>';
    } else if (data.history.length === 0) {
      historyDiv.innerHTML = '<p>' + (currentLang === 'ms' ? 'Tiada rekod' : 'No records') + '</p>';
    } else {
      let html = '';
      for (let h of data.history) {
        if (h.type === 'Leave') {
          html += '<div class="history-item"><i class="fas fa-calendar"></i> <strong>' + (currentLang === 'ms' ? 'Cuti' : 'Leave') + '</strong> ' + h.leaveType + ' (' + h.halfDay + ') ' + h.start + ' → ' + h.end + ' - ' + h.status + '</div>';
        } else if (h.type === 'Overtime') {
          html += '<div class="history-item"><i class="fas fa-clock"></i> <strong>' + (currentLang === 'ms' ? 'Lebih Masa' : 'Overtime') + '</strong> ' + h.date + ' ' + h.hours + 'h = RM' + parseFloat(h.amount).toFixed(2) + ' - ' + h.status + '</div>';
        } else if (h.type === 'Claim') {
          html += '<div class="history-item"><i class="fas fa-receipt"></i> <strong>' + (currentLang === 'ms' ? 'Tuntutan' : 'Claim') + '</strong> ' + h.claimType + ' RM' + parseFloat(h.amount).toFixed(2) + ' (' + h.claimDate + ') - ' + h.status + '</div>';
        } else if (h.type === 'Receipt') {
          html += '<div class="history-item"><i class="fas fa-paperclip"></i> <strong>' + (currentLang === 'ms' ? 'Resit' : 'Receipt') + '</strong> ' + h.receiptType + ' - <a href="' + h.fileUrl + '" target="_blank">' + (currentLang === 'ms' ? 'lihat' : 'view') + '</a> - ' + h.status + '</div>';
        }
        html += '</div>';
      }
      historyDiv.innerHTML = html;
    }
  } finally {
    isLoading = false;
    loadHistoryBtn.disabled = false;
    loadHistoryBtn.style.opacity = '1';
  }
};
  
  // Tab switching
  const tabs = document.querySelectorAll('.tab');
  const panes = {
    'request-tab': document.getElementById('request-tab'),
    'chat-tab': document.getElementById('chat-tab'),
    'history-tab': document.getElementById('history-tab'),
    'calendar-tab': document.getElementById('calendar-tab')
  };
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      Object.keys(panes).forEach(p => panes[p].style.display = 'none');
      panes[tab.dataset.tab + '-tab'].style.display = 'block';
      if (tab.dataset.tab === 'calendar') {
        setTimeout(loadCalendar, 100);
      }
    });
  });
  
  // Calendar month change
  const calendarMonthInput = document.getElementById('calendarMonth');
  if (calendarMonthInput) {
    const now = new Date();
    calendarMonthInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    calendarMonthInput.addEventListener('change', loadCalendar);
  }
  
  // ========== INIT ==========
  applyUILanguage();
  renderRequests();
  setTimeout(loadCalendar, 200);
  
})();
</script>
</body>
</html>`;

// ============================================================
// ADMIN PANEL (FULLY BILINGUAL) - RECEIPTS TABS INCLUDED
// ============================================================

async function renderAdminPanel(env, errorMsg = null, lang = 'ms') {
  await ensureAllSheetsExist(env);
  
  const leaves = await readSheet('LeaveRequests!A:K', env);
  const ots = await readSheet('OvertimeRequests!A:K', env);
  
  // Get all claims from separated sheets
  const claimSheets = ['Claims_Hotel', 'Claims_Distance', 'Claims_Meal', 'Claims_TNG', 'Claims_Item'];
  let allClaims = [];
  for (const sheet of claimSheets) {
    const rows = await readSheet(`${sheet}!A:Z`, env);
    if (rows && rows.length > 1) {
      for (const r of rows.slice(1)) {
        const statusIndex = r.length - 2;
        const amountIndex = r.length - 3;
        allClaims.push({
          sheet: sheet,
          timestamp: r[0] || '',
          id: r[1] || '',
          email: r[2] || '',
          name: r[3] || '',
          claimDate: r[4] || '',
          claimType: sheet.replace('Claims_', ''),
          amount: parseFloat(r[amountIndex]) || 0,
          status: r[statusIndex] || 'pending',
          from: r[5] || '',
          to: r[6] || '',
          km: r[7] || '',
          checkIn: r[8] || '',
          checkOut: r[9] || '',
          itemDesc: r[10] || ''
        });
      }
    }
  }

  // Get receipts
const receipts = await readSheet('Receipts!A:G', env);
const pendingReceipts = receipts.slice(1).filter(r => r[6] === 'pending').map(r => ({
  id: r[0] || Date.now().toString(),
  timestamp: r[0] || '',
  email: r[1] || '',
  name: r[2] || '',
  receiptType: r[3] || '',
  fileUrl: r[4] || '',
  description: r[5] || '',
  status: r[6] || 'pending'
}));

const historyReceipts = receipts.slice(1).filter(r => r[6] === 'approved' || r[6] === 'rejected').map(r => ({
  id: r[0] || Date.now().toString(),
  timestamp: r[0] || '',
  email: r[1] || '',
  name: r[2] || '',
  receiptType: r[3] || '',
  fileUrl: r[4] || '',
  description: r[5] || '',
  status: r[6] || 'pending'
}));
  
  // Translations
  const t = {
    ms: {
      pageTitle: "Versafac HR Admin",
      refresh: "Muat Semula",
      logout: "Log Keluar",
      totalLeave: "Jumlah Cuti",
      totalOt: "Jumlah OT",
      totalClaim: "Jumlah Tuntutan",
      leave: "Cuti",
      overtime: "Lebih Masa",
      claim: "Tuntutan",
      pending: "Dalam Proses",
      history: "Sejarah",
      pendingLeave: "Permohonan Cuti Menunggu",
      pendingOt: "Permohonan OT Menunggu",
      pendingClaim: "Tuntutan Menunggu",
      historyLeave: "Sejarah Permohonan Cuti",
      historyOt: "Sejarah Permohonan OT",
      historyClaim: "Sejarah Tuntutan",
      approve: "Lulus",
      reject: "Tolak",
      approved: "Diluluskan",
      rejected: "Ditolak",
      pendingStatus: "Dalam Proses",
      id: "ID",
      name: "Nama",
      email: "Email",
      type: "Jenis",
      date: "Tarikh",
      hours: "Jam",
      amount: "Jumlah",
      claimDate: "Tarikh Tuntutan",
      claimType: "Jenis",
      details: "Butiran",
      status: "Status",
      action: "Tindakan",
      noRecords: "Tiada rekod",
      confirmApprove: "Sahkan lulus permohonan ini?",
      confirmReject: "Sahkan tolak permohonan ini?",
      error: "Ralat",
      settings: "Tetapan"
    },
    en: {
      pageTitle: "Versafac HR Admin",
      refresh: "Refresh",
      logout: "Logout",
      totalLeave: "Total Leave",
      totalOt: "Total OT",
      totalClaim: "Total Claim",
      leave: "Leave",
      overtime: "Overtime",
      claim: "Claim",
      pending: "Pending",
      history: "History",
      pendingLeave: "Pending Leave Requests",
      pendingOt: "Pending Overtime Requests",
      pendingClaim: "Pending Claims",
      historyLeave: "Leave History",
      historyOt: "Overtime History",
      historyClaim: "Claim History",
      approve: "Approve",
      reject: "Reject",
      approved: "Approved",
      rejected: "Rejected",
      pendingStatus: "Pending",
      id: "ID",
      name: "Name",
      email: "Email",
      type: "Type",
      date: "Date",
      hours: "Hours",
      amount: "Amount",
      claimDate: "Claim Date",
      claimType: "Type",
      details: "Details",
      status: "Status",
      action: "Action",
      noRecords: "No records",
      confirmApprove: "Confirm approve this request?",
      confirmReject: "Confirm reject this request?",
      error: "Error",
      settings: "Settings"
    }
  };
  
  const text = t[lang];
  
  // Process data
  const processLeaves = (statusFilter) => leaves.slice(1).filter(r => (statusFilter === 'all' || r[9] === statusFilter)).map(r => ({ 
    id: r[1], name: r[3], email: r[2], type: r[4], start: r[6], end: r[7], halfDay: r[5], status: r[9], timestamp: r[0] 
  }));
  
  const processOts = (statusFilter) => ots.slice(1).filter(r => (statusFilter === 'all' || r[9] === statusFilter)).map(r => ({ 
    id: r[1], name: r[3], email: r[2], date: r[4], hours: r[5], amount: r[7], status: r[9], timestamp: r[0] 
  }));
  
  const processClaims = (statusFilter) => allClaims.filter(r => (statusFilter === 'all' || r.status === statusFilter));
  
  // Pending items
  const pendingLeaves = processLeaves('pending');
  const pendingOts = processOts('pending');
  const pendingClaims = processClaims('pending');
  
  // History items (approved + rejected)
  const historyLeaves = leaves.slice(1).filter(r => r[9] === 'approved' || r[9] === 'rejected').map(r => ({ 
    id: r[1], name: r[3], email: r[2], type: r[4], start: r[6], end: r[7], halfDay: r[5], status: r[9], timestamp: r[0] 
  }));
  
  const historyOts = ots.slice(1).filter(r => r[9] === 'approved' || r[9] === 'rejected').map(r => ({ 
    id: r[1], name: r[3], email: r[2], date: r[4], hours: r[5], amount: r[7], status: r[9], timestamp: r[0] 
  }));
  
  const historyClaims = processClaims('approved');
  historyClaims.push(...processClaims('rejected'));
  
  // Sort history by timestamp
  historyLeaves.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  historyOts.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  historyClaims.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  const renderTable = (items, type, showStatus = true, showActions = true) => {
    if (items.length === 0) return '<div class="no-data"><i class="fas fa-inbox"></i> ' + text.noRecords + '</div>';
    
    let html = `<div class="table-wrapper"><table>`;
    html += `<thead><tr>`;
    html += `<th>${text.id}</th><th>${text.name}</th><th>${text.email}</th>`;
    if (type === 'leave') html += `<th>${text.type}</th><th>${text.date}</th>`;
    else if (type === 'overtime') html += `<th>${text.date}</th><th>${text.hours}</th><th>${text.amount}</th>`;
    else if (type === 'claim') html += `<th>${text.claimDate}</th><th>${text.claimType}</th><th>${text.amount}</th><th>${text.details}</th>`;
    if (showStatus) html += `<th>${text.status}</th>`;
    if (showActions) html += `<th>${text.action}</th>`;
    html += `</tr></thead><tbody>`;
    
    for (const item of items) {
      let statusBadge = '';
      if (item.status === 'approved') statusBadge = '<span class="badge-approved"><i class="fas fa-check-circle"></i> ' + text.approved + '</span>';
      else if (item.status === 'rejected') statusBadge = '<span class="badge-rejected"><i class="fas fa-times-circle"></i> ' + text.rejected + '</span>';
      else statusBadge = '<span class="badge-pending"><i class="fas fa-clock"></i> ' + text.pendingStatus + '</span>';
      
      html += `<tr>`;
      html += `<td>${escapeHtml(item.id)}</td>`;
      html += `<td>${escapeHtml(item.name)}</td>`;
      html += `<td>${escapeHtml(item.email)}</td>`;
      
      if (type === 'leave') {
        html += `<td>${item.type}</td>`;
        html += `<td>${item.start} → ${item.end} ${item.halfDay !== 'full' ? '(' + item.halfDay + ')' : ''}</td>`;
        if (showStatus) html += `<td class="status-cell">${statusBadge}</td>`;
        if (showActions && item.status === 'pending') {
          html += `<td class="action-cell">
            <button class="approve-btn" onclick="approve('leave','${item.id}')"><i class="fas fa-check"></i> ${text.approve}</button>
            <button class="reject-btn" onclick="reject('leave','${item.id}')"><i class="fas fa-times"></i> ${text.reject}</button>
          </td>`;
        } else if (showActions) {
          html += `<td class="action-cell">-</td>`;
        }
      } 
      else if (type === 'overtime') {
        html += `<td>${item.date}</td>`;
        html += `<td>${item.hours}</td>`;
        html += `<td>RM${parseFloat(item.amount).toFixed(2)}</td>`;
        if (showStatus) html += `<td class="status-cell">${statusBadge}</td>`;
        if (showActions && item.status === 'pending') {
          html += `<td class="action-cell">
            <button class="approve-btn" onclick="approve('overtime','${item.id}')"><i class="fas fa-check"></i> ${text.approve}</button>
            <button class="reject-btn" onclick="reject('overtime','${item.id}')"><i class="fas fa-times"></i> ${text.reject}</button>
          </td>`;
        } else if (showActions) {
          html += `<td class="action-cell">-</td>`;
        }
      } 
      else if (type === 'claim') {
        let detail = '';
        if (item.claimType === 'Distance') detail = `${item.from} → ${item.to} (${item.km} km)`;
        else if (item.claimType === 'Hotel') detail = `${item.checkIn} → ${item.checkOut}`;
        else if (item.claimType === 'Item') detail = item.itemDesc;
        else detail = '-';
        html += `<td>${item.claimDate}</td>`;
        html += `<td>${item.claimType}</td>`;
        html += `<td>RM${parseFloat(item.amount).toFixed(2)}</td>`;
        html += `<td>${detail}</td>`;
        if (showStatus) html += `<td class="status-cell">${statusBadge}</td>`;
        if (showActions && item.status === 'pending') {
          html += `<td class="action-cell">
            <button class="approve-btn" onclick="approve('claim','${item.id}')"><i class="fas fa-check"></i> ${text.approve}</button>
            <button class="reject-btn" onclick="reject('claim','${item.id}')"><i class="fas fa-times"></i> ${text.reject}</button>
          </td>`;
        } else if (showActions) {
          html += `<td class="action-cell">-</td>`;
        }
      }
      html += `</tr>`;
    }
    html += `</tbody></table></div>`;
    return html;
  };

  const renderReceiptTable = (items, showActions = true) => {
  if (items.length === 0) return '<div class="no-data"><i class="fas fa-inbox"></i> No receipts</div>';
  
  let html = `<div class="table-wrapper"><table>`;
  html += `<thead><tr>`;
  html += `<th>Timestamp</th><th>Name</th><th>Email</th><th>Type</th><th>File</th><th>Description</th><th>Status</th>`;
  if (showActions) html += `<th>Action</th>`;
  html += `</tr></thead><tbody>`;
  
  for (const item of items) {
    let statusBadge = '';
    if (item.status === 'approved') statusBadge = '<span class="badge-approved"><i class="fas fa-check-circle"></i> Approved</span>';
    else if (item.status === 'rejected') statusBadge = '<span class="badge-rejected"><i class="fas fa-times-circle"></i> Rejected</span>';
    else statusBadge = '<span class="badge-pending"><i class="fas fa-clock"></i> Pending</span>';
    
    const fileLink = item.fileUrl && item.fileUrl.startsWith('http') 
      ? `<a href="${item.fileUrl}" target="_blank" style="color:#00aa6e;"><i class="fas fa-external-link-alt"></i> View</a>` 
      : item.fileUrl || 'No file';
    
    html += `<tr>`;
    html += `<td>${escapeHtml(item.timestamp)}</td>`;
    html += `<td>${escapeHtml(item.name)}</td>`;
    html += `<td>${escapeHtml(item.email)}</td>`;
    html += `<td><span class="badge-pending" style="background:#3b82f620;color:#3b82f6;">${escapeHtml(item.receiptType)}</span></td>`;
    html += `<td>${fileLink}</td>`;
    html += `<td>${escapeHtml(item.description || '-')}</td>`;
    html += `<td class="status-cell">${statusBadge}</td>`;
    if (showActions && item.status === 'pending') {
      html += `<td class="action-cell">
        <button class="approve-btn" onclick="approveReceipt('${item.id}')"><i class="fas fa-check"></i> Approve</button>
        <button class="reject-btn" onclick="rejectReceipt('${item.id}')"><i class="fas fa-times"></i> Reject</button>
      </td>`;
    } else if (showActions) {
      html += `<td class="action-cell">-</td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;
  return html;
};
  
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${text.pageTitle}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Inter', sans-serif; background: #f0f2f5; padding: 24px; }
    .container { max-width: 1600px; margin: 0 auto; }
    
    .header { background: white; border-radius: 24px; padding: 20px 28px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .header h1 { color: #00aa6e; font-size: 1.8rem; display: flex; align-items: center; gap: 12px; }
    .header h1 i { font-size: 2rem; }
    .header-buttons { display: flex; gap: 12px; }
    .lang-btn, .refresh-btn, .logout-btn { padding: 10px 20px; border-radius: 40px; border: none; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 0.9rem; }
    .lang-btn { background: #eef2f8; color: #2c3e50; }
    .refresh-btn { background: #eef2f8; color: #2c3e50; }
    .logout-btn { background: #dc2626; color: white; }
    .lang-btn:hover { background: #00aa6e20; }
    .refresh-btn:hover { background: #00aa6e20; }
    .logout-btn:hover { background: #b91c1c; }
    
    .main-tabs { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
    .main-tab { padding: 12px 28px; border-radius: 40px; font-weight: 700; font-size: 1rem; cursor: pointer; background: white; border: none; color: #4a5568; display: flex; align-items: center; gap: 10px; transition: all 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .main-tab i { font-size: 1.1rem; }
    .main-tab.active { background: #00aa6e; color: white; box-shadow: 0 4px 12px rgba(0,170,110,0.3); }
    .main-tab:hover:not(.active) { background: #eef2f8; }
    
    .sub-tabs { display: flex; gap: 8px; margin-bottom: 20px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
    .sub-tab { padding: 8px 24px; border-radius: 40px; font-weight: 600; cursor: pointer; background: none; border: none; color: #6b7280; transition: all 0.2s; }
    .sub-tab.active { background: #00aa6e; color: white; }
    .sub-tab:hover:not(.active) { background: #eef2f8; color: #374151; }
    
    .stats { display: flex; gap: 20px; margin-bottom: 24px; flex-wrap: wrap; }
    .stat-card { background: white; border-radius: 20px; padding: 16px 24px; display: flex; align-items: center; gap: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); flex: 1; min-width: 150px; }
    .stat-icon { width: 50px; height: 50px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; }
    .stat-icon.leave { background: #00aa6e20; color: #00aa6e; }
    .stat-icon.ot { background: #f59e0b20; color: #f59e0b; }
    .stat-icon.claim { background: #3b82f620; color: #3b82f6; }
    .stat-info h3 { font-size: 1.8rem; font-weight: 700; }
    .stat-info p { color: #6b7280; font-size: 0.85rem; }
    
    .table-wrapper { overflow-x: auto; background: white; border-radius: 20px; padding: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 14px 16px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; font-weight: 600; color: #374151; }
    tr:hover { background: #f9fafb; }
    
    .badge-approved { background: #10b98120; color: #059669; padding: 4px 12px; border-radius: 30px; font-size: 0.8rem; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
    .badge-rejected { background: #ef444420; color: #dc2626; padding: 4px 12px; border-radius: 30px; font-size: 0.8rem; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
    .badge-pending { background: #f59e0b20; color: #d97706; padding: 4px 12px; border-radius: 30px; font-size: 0.8rem; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
    
    .approve-btn { background: #10b981; color: white; border: none; padding: 6px 14px; border-radius: 30px; cursor: pointer; font-weight: 600; margin-right: 8px; display: inline-flex; align-items: center; gap: 6px; font-size: 0.8rem; }
    .reject-btn { background: #ef4444; color: white; border: none; padding: 6px 14px; border-radius: 30px; cursor: pointer; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; font-size: 0.8rem; }
    .approve-btn:hover { background: #059669; }
    .reject-btn:hover { background: #dc2626; }
    
    .status-cell { width: 130px; }
    .action-cell { width: 180px; }
    
    .no-data { text-align: center; padding: 60px; color: #9ca3af; font-size: 1rem; background: white; border-radius: 20px; }
    .no-data i { font-size: 3rem; margin-bottom: 16px; display: block; }
    
    @media (max-width: 768px) {
      body { padding: 12px; }
      .header { flex-direction: column; text-align: center; }
      .main-tab { padding: 8px 16px; font-size: 0.8rem; }
      th, td { padding: 10px 12px; font-size: 0.8rem; }
      .action-cell { white-space: nowrap; }
    }
  </style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1><i class="fas fa-leaf"></i> ${text.pageTitle}</h1>
    <div class="header-buttons">
      <a href="/admin/settings?lang=${lang}" style="background:#6b7280;color:white;padding:10px 20px;border-radius:40px;text-decoration:none;display:inline-flex;align-items:center;gap:8px;"><i class="fas fa-sliders-h"></i> ${text.settings}</a>
      <button class="lang-btn" onclick="toggleLanguage()"><i class="fas fa-globe"></i> ${lang === 'ms' ? 'English' : 'Melayu'}</button>
      <button class="refresh-btn" onclick="location.reload()"><i class="fas fa-sync-alt"></i> ${text.refresh}</button>
      <button class="logout-btn" onclick="logout()"><i class="fas fa-sign-out-alt"></i> ${text.logout}</button>
    </div>
  </div>
  
  ${errorMsg ? `<div style="background:#fee2e2; color:#b91c1c; padding:16px; border-radius:16px; margin-bottom:20px;"><i class="fas fa-exclamation-triangle"></i> ${errorMsg}</div>` : ''}
  
  <div class="stats">
    <div class="stat-card">
      <div class="stat-icon leave"><i class="fas fa-calendar-alt"></i></div>
      <div class="stat-info">
        <h3>${pendingLeaves.length + historyLeaves.length}</h3>
        <p>${text.totalLeave}</p>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon ot"><i class="fas fa-clock"></i></div>
      <div class="stat-info">
        <h3>${pendingOts.length + historyOts.length}</h3>
        <p>${text.totalOt}</p>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon claim"><i class="fas fa-receipt"></i></div>
      <div class="stat-info">
        <h3>${pendingClaims.length + historyClaims.length}</h3>
        <p>${text.totalClaim}</p>
      </div>
    </div>
  </div>
  
  <div class="main-tabs">
  <button class="main-tab active" data-main="leave"><i class="fas fa-calendar-alt"></i> ${text.leave}</button>
  <button class="main-tab" data-main="overtime"><i class="fas fa-clock"></i> ${text.overtime}</button>
  <button class="main-tab" data-main="claim"><i class="fas fa-receipt"></i> ${text.claim}</button>
  <button class="main-tab" data-main="receipts"><i class="fas fa-paperclip"></i> Receipts</button>
</div>
  
  <div id="leaveSection" class="main-section">
    <div class="sub-tabs">
      <button class="sub-tab active" data-sub="pending-leave"><i class="fas fa-clock"></i> ${text.pending} (${pendingLeaves.length})</button>
      <button class="sub-tab" data-sub="history-leave"><i class="fas fa-history"></i> ${text.history} (${historyLeaves.length})</button>
    </div>
    <div id="pending-leave" class="sub-section">
      <h3 style="margin-bottom: 16px;"><i class="fas fa-hourglass-half"></i> ${text.pendingLeave}</h3>
      ${renderTable(pendingLeaves, 'leave', true, true)}
    </div>
    <div id="history-leave" class="sub-section" style="display: none;">
      <h3 style="margin-bottom: 16px;"><i class="fas fa-history"></i> ${text.historyLeave}</h3>
      ${renderTable(historyLeaves, 'leave', true, false)}
    </div>
  </div>
  
  <div id="overtimeSection" class="main-section" style="display: none;">
    <div class="sub-tabs">
      <button class="sub-tab active" data-sub="pending-ot"><i class="fas fa-clock"></i> ${text.pending} (${pendingOts.length})</button>
      <button class="sub-tab" data-sub="history-ot"><i class="fas fa-history"></i> ${text.history} (${historyOts.length})</button>
    </div>
    <div id="pending-ot" class="sub-section">
      <h3 style="margin-bottom: 16px;"><i class="fas fa-hourglass-half"></i> ${text.pendingOt}</h3>
      ${renderTable(pendingOts, 'overtime', true, true)}
    </div>
    <div id="history-ot" class="sub-section" style="display: none;">
      <h3 style="margin-bottom: 16px;"><i class="fas fa-history"></i> ${text.historyOt}</h3>
      ${renderTable(historyOts, 'overtime', true, false)}
    </div>
  </div>
  
  <div id="claimSection" class="main-section" style="display: none;">
    <div class="sub-tabs">
      <button class="sub-tab active" data-sub="pending-claim"><i class="fas fa-clock"></i> ${text.pending} (${pendingClaims.length})</button>
      <button class="sub-tab" data-sub="history-claim"><i class="fas fa-history"></i> ${text.history} (${historyClaims.length})</button>
    </div>
    <div id="pending-claim" class="sub-section">
      <h3 style="margin-bottom: 16px;"><i class="fas fa-hourglass-half"></i> ${text.pendingClaim}</h3>
      ${renderTable(pendingClaims, 'claim', true, true)}
    </div>
    <div id="history-claim" class="sub-section" style="display: none;">
      <h3 style="margin-bottom: 16px;"><i class="fas fa-history"></i> ${text.historyClaim}</h3>
      ${renderTable(historyClaims, 'claim', true, false)}
    </div>
  </div>

<div id="receiptsSection" class="main-section" style="display: none;">
  <div class="sub-tabs">
    <button class="sub-tab active" data-sub="pending-receipts"><i class="fas fa-clock"></i> Pending (${pendingReceipts.length})</button>
    <button class="sub-tab" data-sub="history-receipts"><i class="fas fa-history"></i> History (${historyReceipts.length})</button>
  </div>
  <div id="pending-receipts" class="sub-section">
    <h3 style="margin-bottom: 16px;"><i class="fas fa-hourglass-half"></i> Pending Receipts</h3>
    ${renderReceiptTable(pendingReceipts, true)}
  </div>
  <div id="history-receipts" class="sub-section" style="display: none;">
    <h3 style="margin-bottom: 16px;"><i class="fas fa-history"></i> Receipt History</h3>
    ${renderReceiptTable(historyReceipts, false)}
  </div>
</div>

<script>
let currentLang = '${lang}';

function toggleLanguage() {
  currentLang = currentLang === 'ms' ? 'en' : 'ms';
  window.location.href = '/admin?lang=' + currentLang;
}

document.querySelectorAll('.main-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.main-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const mainTab = btn.dataset.main;
    document.querySelectorAll('.main-section').forEach(section => section.style.display = 'none');
    document.getElementById(mainTab + 'Section').style.display = 'block';
  });
});

function initSubTabs(prefix) {
  const subBtns = document.querySelectorAll('#' + prefix + 'Section .sub-tab');
  subBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      subBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const subTab = btn.dataset.sub;
      document.querySelectorAll('#' + prefix + 'Section .sub-section').forEach(section => section.style.display = 'none');
      document.getElementById(subTab).style.display = 'block';
    });
  });
}

initSubTabs('leave');
initSubTabs('overtime');
initSubTabs('claim');
initSubTabs('receipts');

async function approve(type, id) {
  if(confirm('${text.confirmApprove}')) {
    const r = await fetch('/api/approve-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, requestId: id, status: 'approved' })
    });
    const d = await r.json();
    if(d.success) location.reload();
    else alert('${text.error}: ' + d.error);
  }
}

async function reject(type, id) {
  if(confirm('${text.confirmReject}')) {
    const r = await fetch('/api/approve-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, requestId: id, status: 'rejected' })
    });
    const d = await r.json();
    if(d.success) location.reload();
    else alert('${text.error}: ' + d.error);
  }
}

async function approveReceipt(id) {
  if(confirm('Confirm approve this receipt?')) {
    const r = await fetch('/api/approve-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: id, status: 'approved' })
    });
    const d = await r.json();
    if(d.success) location.reload();
    else alert('Error: ' + d.error);
  }
}

async function rejectReceipt(id) {
  if(confirm('Confirm reject this receipt?')) {
    const r = await fetch('/api/approve-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: id, status: 'rejected' })
    });
    const d = await r.json();
    if(d.success) location.reload();
    else alert('Error: ' + d.error);
  }
}

function logout() {
  window.location.href = '/admin';
}
</script>
</body>
</html>`;
}

// ============================================================
// ADMIN SETTINGS PANEL
// ============================================================

async function renderSettingsPanel(env, errorMsg = null, lang = 'ms') {
  try {
    const settings = await getSettings(env);
    const employees = await getAllEmployees(env);
    
    const t = {
      ms: {
        title: "Tetapan Sistem",
        distanceRate: "Kadar Perjalanan (RM/km)",
        hotelRate: "Kadar Hotel (RM/malam)",
        otRateWeekday: "Kadar OT Hari Biasa (RM/jam)",
        otRateSaturday: "Kadar OT Sabtu (RM/jam)",
        otRateSunday: "Kadar OT Ahad (RM/jam)",
        employees: "Senarai Pekerja",
        email: "Email",
        name: "Nama",
        annualLeave: "Cuti Tahunan (hari)",
        addEmployee: "Tambah Pekerja Baru",
        update: "Kemaskini",
        save: "Simpan",
        back: "Kembali ke Admin",
        success: "Berjaya disimpan!",
        error: "Ralat",
        english: "English",
        melayu: "Melayu"
      },
      en: {
        title: "System Settings",
        distanceRate: "Travel Rate (RM/km)",
        hotelRate: "Hotel Rate (RM/night)",
        otRateWeekday: "Weekday OT Rate (RM/hour)",
        otRateSaturday: "Saturday OT Rate (RM/hour)",
        otRateSunday: "Sunday OT Rate (RM/hour)",
        employees: "Employee List",
        email: "Email",
        name: "Name",
        annualLeave: "Annual Leave (days)",
        addEmployee: "Add New Employee",
        update: "Update",
        save: "Save",
        back: "Back to Admin",
        success: "Saved successfully!",
        error: "Error",
        english: "English",
        melayu: "Melayu"
      }
    };
    
    const text = t[lang];
    
    let employeeRows = '';
    for (const emp of employees) {
      employeeRows += `<tr>
        <td><input type="email" class="email-input" value="${escapeHtml(emp.email)}" style="width:100%;padding:8px;border-radius:20px;border:1px solid #ddd;"></td>
        <td><input type="text" class="name-input" value="${escapeHtml(emp.name)}" style="width:100%;padding:8px;border-radius:20px;border:1px solid #ddd;"></td>
        <td><input type="number" step="0.5" class="leave-input" value="${emp.annualLeave}" style="width:100px;padding:8px;border-radius:20px;border:1px solid #ddd;"></td>
        <td><button class="updateEmployeeBtn" data-email="${escapeHtml(emp.email)}" style="background:#00aa6e;color:white;border:none;padding:6px 16px;border-radius:20px;cursor:pointer;">${text.update}</button></td>
      </tr>`;
    }
    
    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${text.title} - Versafac HR</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Inter', sans-serif; background: #f0f2f5; padding: 24px; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { background: white; border-radius: 24px; padding: 20px 28px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .header h1 { color: #00aa6e; display: flex; align-items: center; gap: 12px; }
    .header-buttons { display: flex; gap: 12px; }
    .lang-btn { background: #eef2f8; color: #2c3e50; border: none; padding: 8px 20px; border-radius: 40px; cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .back-btn { background: #6b7280; color: white; padding: 10px 20px; border-radius: 40px; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
    .back-btn:hover { background: #4b5563; }
    .lang-btn:hover { background: #00aa6e20; }
    .card { background: white; border-radius: 24px; padding: 24px; margin-bottom: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .card h2 { margin-bottom: 20px; color: #374151; font-size: 1.3rem; display: flex; align-items: center; gap: 10px; }
    .form-group { margin-bottom: 20px; }
    label { display: block; margin-bottom: 8px; font-weight: 600; color: #374151; }
    input, select { width: 100%; padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 40px; font-size: 1rem; }
    input:focus { outline: none; border-color: #00aa6e; box-shadow: 0 0 0 3px rgba(0,170,110,0.1); }
    button { background: #00aa6e; color: white; border: none; padding: 12px 24px; border-radius: 40px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
    button:hover { background: #008855; transform: translateY(-2px); }
    .settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 20px; }
    .employee-form { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 12px; align-items: end; margin-bottom: 20px; }
    .employee-form input { margin-bottom: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; font-weight: 600; color: #374151; }
    tr:hover { background: #f9fafb; }
    .success-msg { background: #10b98120; color: #059669; padding: 12px 16px; border-radius: 16px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; }
    .error-msg { background: #ef444420; color: #dc2626; padding: 12px 16px; border-radius: 16px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; }
    @media (max-width: 768px) {
      body { padding: 12px; }
      .employee-form { grid-template-columns: 1fr; }
      .settings-grid { grid-template-columns: 1fr; }
      .header { flex-direction: column; text-align: center; }
    }
  </style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1><i class="fas fa-sliders-h"></i> ${text.title}</h1>
    <div class="header-buttons">
      <button class="lang-btn" onclick="toggleLanguage()"><i class="fas fa-globe"></i> ${lang === 'ms' ? text.english : text.melayu}</button>
      <a href="/admin?lang=${lang}" class="back-btn"><i class="fas fa-arrow-left"></i> ${text.back}</a>
    </div>
  </div>
  
  <div id="message"></div>
  
  <div class="card">
    <h2><i class="fas fa-coins"></i> ${text.employees === 'Senarai Pekerja' ? 'Kadar Tuntutan' : 'Claim Rates'}</h2>
    <div class="settings-grid">
      <div class="form-group">
        <label>🚗 ${text.distanceRate}</label>
        <input type="number" id="distanceRate" step="0.01" value="${settings.distanceRate}">
      </div>
      <div class="form-group">
        <label>🏨 ${text.hotelRate}</label>
        <input type="number" id="hotelRate" step="0.01" value="${settings.hotelRate}">
      </div>
      <div class="form-group">
        <label>📅 ${text.otRateWeekday}</label>
        <input type="number" id="otRateWeekday" step="0.01" value="${settings.otRateWeekday}">
      </div>
      <div class="form-group">
        <label>📅 ${text.otRateSaturday}</label>
        <input type="number" id="otRateSaturday" step="0.01" value="${settings.otRateSaturday}">
      </div>
      <div class="form-group">
        <label>📅 ${text.otRateSunday}</label>
        <input type="number" id="otRateSunday" step="0.01" value="${settings.otRateSunday}">
      </div>
    </div>
    <button id="saveSettingsBtn" style="width:100%;"><i class="fas fa-save"></i> ${text.save}</button>
  </div>
  
  <div class="card">
    <h2><i class="fas fa-users"></i> ${text.employees}</h2>
    
    <div style="margin-bottom: 20px; display: flex; gap: 10px; align-items: center;">
      <input type="month" id="reportMonth" style="padding: 10px; border-radius: 40px; flex:1;">
      <button id="exportReportBtn" style="background:#6b7280;"><i class="fas fa-file-pdf"></i> Export Report</button>
    </div>
    
    <div class="employee-form">
      <input type="email" id="newEmail" placeholder="${text.email}">
      <input type="text" id="newName" placeholder="${text.name}">
      <input type="number" id="newAnnualLeave" step="0.5" placeholder="${text.annualLeave}">
      <button id="addEmployeeBtn"><i class="fas fa-plus"></i> ${text.addEmployee}</button>
    </div>
    
    <div style="overflow-x: auto;">
      <table>
        <thead>
          <tr><th>${text.email}</th><th>${text.name}</th><th>${text.annualLeave}</th><th>${text.update}</th></tr>
        </thead>
        <tbody id="employeesTable">
          ${employeeRows}
        </tbody>
      </table>
    </div>
  </div>
</div>

<script>
const currentLang = '${lang}';

function toggleLanguage() {
  const newLang = currentLang === 'ms' ? 'en' : 'ms';
  window.location.href = '/admin/settings?lang=' + newLang;
}

document.getElementById('saveSettingsBtn').onclick = async () => {
  const data = {
    distanceRate: document.getElementById('distanceRate').value,
    hotelRate: document.getElementById('hotelRate').value,
    otRateWeekday: document.getElementById('otRateWeekday').value,
    otRateSaturday: document.getElementById('otRateSaturday').value,
    otRateSunday: document.getElementById('otRateSunday').value
  };
  const r = await fetch('/api/update-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const d = await r.json();
  showMessage(d.success);
};

document.querySelectorAll('.updateEmployeeBtn').forEach(btn => {
  btn.onclick = async () => {
    const oldEmail = btn.dataset.email;
    const row = btn.closest('tr');
    const cells = row.querySelectorAll('td');
    const newEmail = cells[0].querySelector('.email-input').value;
    const newName = cells[1].querySelector('.name-input').value;
    const newBalance = cells[2].querySelector('.leave-input').value;
    if (!newEmail || !newName) {
      showMessage(false, '${lang === 'ms' ? 'Sila isi email dan nama' : 'Please fill in email and name'}');
      return;
    }
    const r = await fetch('/api/update-employee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldEmail, newEmail, newName, annualLeave: parseFloat(newBalance) })
    });
    const d = await r.json();
    showMessage(d.success);
    if (d.success) setTimeout(() => location.reload(), 1500);
  };
});

document.getElementById('addEmployeeBtn').onclick = async () => {
  const email = document.getElementById('newEmail').value;
  const name = document.getElementById('newName').value;
  const annualLeave = document.getElementById('newAnnualLeave').value;
  if (!email || !name) {
    showMessage(false, '${lang === 'ms' ? 'Sila isi email dan nama' : 'Please fill in email and name'}');
    return;
  }
  const r = await fetch('/api/add-employee', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name, annualLeave: annualLeave || 0 })
  });
  const d = await r.json();
  if (d.success) {
    location.reload();
  } else {
    showMessage(false, d.error);
  }
};

function showMessage(success, customMsg = null) {
  const msgDiv = document.getElementById('message');
  const msg = success ? '${text.success}' : (customMsg || '${text.error}');
  msgDiv.innerHTML = '<div class="' + (success ? 'success-msg' : 'error-msg') + '"><i class="fas fa-' + (success ? 'check-circle' : 'exclamation-triangle') + '"></i> ' + msg + '</div>';
  setTimeout(() => { msgDiv.innerHTML = ''; }, 3000);
}

const exportReportBtn = document.getElementById('exportReportBtn');
const reportMonthInput = document.getElementById('reportMonth');
if (exportReportBtn && reportMonthInput) {
  const now = new Date();
  reportMonthInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  exportReportBtn.addEventListener('click', function() {
    const [year, month] = reportMonthInput.value.split('-');
    window.open('/api/export-report?year=' + year + '&month=' + month + '&lang=' + currentLang, '_blank');
  });
}
</script>
</body>
</html>`;
  } catch (err) {
    console.error('Settings panel error:', err);
    return `<html><body style="font-family:Arial;padding:20px;">
      <h1>Error Loading Settings</h1>
      <p>${err.message}</p>
      <a href="/admin">Back to Admin</a>
    </body></html>`;
  }
}

// ============================================================
// WORKER HANDLER
// ============================================================

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
    const isAdminPath = path === '/admin' || path === '/admin/settings' || path === '/api/approve-request' || path === '/api/approve-receipt';
    if (isAdminPath) {
      const auth = request.headers.get('Authorization');
      const expectedPassword = env.ADMIN_PASSWORD || 'admin123';
      if (!auth || !auth.startsWith('Basic ')) {
        return new Response('Unauthorized', { 
          status: 401, 
          headers: { 'WWW-Authenticate': 'Basic realm="Admin Area", charset="UTF-8"' } 
        });
      }
      const base64Credentials = auth.split(' ')[1];
      const credentials = atob(base64Credentials);
      const [username, password] = credentials.split(':');
      const valid = username === 'admin' && password === expectedPassword;
      if (!valid) {
        return new Response('Unauthorized - Invalid credentials', { 
          status: 401, 
          headers: { 'WWW-Authenticate': 'Basic realm="Admin Area", charset="UTF-8"' } 
        });
      }
    }
    
    if (path === '/favicon.ico') return new Response(null, { status: 204 });
    
    // Admin panel
    if (path === '/admin' && method === 'GET') {
      const urlParams = new URL(request.url).searchParams;
      const lang = urlParams.get('lang') || 'ms';
      const html = await renderAdminPanel(env, null, lang);
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    }
    
    // Settings page
    if (path === '/admin/settings' && method === 'GET') {
      const urlParams = new URL(request.url).searchParams;
      const lang = urlParams.get('lang') || 'ms';
      const html = await renderSettingsPanel(env, null, lang);
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    }
    
    // Dashboard
    if (path === '/' && method === 'GET') {
      return new Response(HTML_DASHBOARD, { headers: { 'Content-Type': 'text/html' } });
    }
    
    // ============ API ENDPOINTS ============
    
    // Check staff
    if (path === '/api/check-staff' && method === 'POST') {
      try {
        const { email } = await request.json();
        const valid = await isStaffValid(email, env);
        let balance = 0;
        if (valid) {
          const data = await getUserLeaveBalance(email, env);
          balance = data ? data.balance : 0;
        }
        return Response.json({ valid, balance });
      } catch (e) { return Response.json({ valid: false, error: e.message }); }
    }
    
    // Chat AI
    if (path === '/api/chat' && method === 'POST') {
      try {
        const { message, email, language } = await request.json();
        const lang = language || detectLanguageSmart(message);
        const reply = await getSmartAIResponse(message, email, lang, env);
        return Response.json({ reply });
      } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
    }
    
    // Submit leave
    if (path === '/api/submit-leave' && method === 'POST') {
      try {
        await ensureAllSheetsExist(env);
        const { email, name, leaveType, halfDay, startDate, endDate } = await request.json();
        const valid = await isStaffValid(email, env);
        if (!valid) return Response.json({ error: 'Email not registered' }, { status: 400 });
        const userBalance = await getUserLeaveBalance(email, env);
        const daysRequested = calculateLeaveDays(startDate, endDate, halfDay);
        if (daysRequested > userBalance.balance) {
          return Response.json({ error: `Insufficient leave balance! Balance: ${userBalance.balance} days` }, { status: 400 });
        }
        const id = Date.now().toString();
        await appendToSheet('LeaveRequests!A:K', [[formatTimestamp(), id, email, name, leaveType, halfDay, startDate, endDate, halfDay === 'full' ? 'Full Day' : 'Half Day', 'pending', '']], env);
        // Telegram in English
        await sendTelegramNotification(env, `📋 NEW LEAVE REQUEST\nName: ${name}\nEmail: ${email}\nType: ${leaveType}\nDate: ${startDate} → ${endDate}\nStatus: PENDING`);
        await sendEmailToHR(env, name, email, 'Leave', 'Type: ' + leaveType + '\nDate: ' + startDate + ' → ' + endDate);
        return Response.json({ success: true });
      } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
    }
    
    // Submit overtime
    if (path === '/api/submit-overtime' && method === 'POST') {
      try {
        await ensureAllSheetsExist(env);
        const { email, fullName, startDateTime, endDateTime, hours, amount, site, description } = await request.json();
        const valid = await isStaffValid(email, env);
        if (!valid) return Response.json({ error: 'Email not registered' }, { status: 400 });
        let finalHours = hours || calculateHours(startDateTime, endDateTime);
        const dateOnly = startDateTime.split('T')[0];
        const rate = getSuggestedRate(dateOnly);
        const finalAmount = amount || (finalHours * rate);
        const id = Date.now().toString();
        await appendToSheet('OvertimeRequests!A:K', [[formatTimestamp(), id, email, fullName, startDateTime, finalHours, rate, finalAmount, description || '', 'pending', '']], env);
        await sendTelegramNotification(env, `⏰ NEW OVERTIME REQUEST\nName: ${fullName}\nEmail: ${email}\nHours: ${finalHours}\nAmount: RM${finalAmount}\nStatus: PENDING`);
        const otDate = startDateTime.split('T')[0];
        await sendEmailToHR(env, fullName, email, 'Overtime', 'Date: ' + otDate + '\nHours: ' + finalHours + ' hours\nAmount: RM' + finalAmount);
        return Response.json({ success: true });
      } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
    }
    
    // Submit claim - SEPARATED BY TYPE
    if (path === '/api/submit-claim' && method === 'POST') {
      try {
        await ensureAllSheetsExist(env);
        const { email, fullName, claimDate, items } = await request.json();
        const valid = await isStaffValid(email, env);
        if (!valid) return Response.json({ error: 'Email not registered' }, { status: 400 });
        const ts = formatTimestamp();
        let itemSummary = [];
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const id = `${Date.now()}_${i}`;
          let from = '', to = '', km = '', checkIn = '', checkOut = '', itemDesc = '';
          let sheetName = '';
          let rowData = [];
          const baseRow = [ts, id, email, fullName, claimDate];
          
          if (it.claimType === 'Hotel') {
            sheetName = 'Claims_Hotel';
            checkIn = it.checkIn || '';
            checkOut = it.checkOut || '';
            const nights = Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24)));
            const settings = await getSettings(env);
            const rate = settings.hotelRate || 150;
            const amount = nights * rate;
            rowData = [...baseRow, checkIn, checkOut, nights, amount, 'pending', ''];
          } else if (it.claimType === 'Distance') {
            sheetName = 'Claims_Distance';
            from = it.from || '';
            to = it.to || '';
            km = it.km || 0;
            const settings = await getSettings(env);
            const rate = settings.distanceRate || 0.60;
            const amount = km * rate;
            rowData = [...baseRow, from, to, km, rate, amount, 'pending', ''];
          } else if (it.claimType === 'Meal') {
            sheetName = 'Claims_Meal';
            const desc = it.description || 'Meal';
            const amount = it.amount || 0;
            rowData = [...baseRow, desc, amount, 'pending', ''];
          } else if (it.claimType === 'Touch n Go') {
            sheetName = 'Claims_TNG';
            const desc = it.description || 'Touch n Go';
            const amount = it.amount || 0;
            rowData = [...baseRow, desc, amount, 'pending', ''];
          } else if (it.claimType === 'Item') {
            sheetName = 'Claims_Item';
            itemDesc = it.itemDesc || '';
            const amount = it.amount || 0;
            rowData = [...baseRow, itemDesc, amount, 'pending', ''];
          }
          
          if (sheetName && rowData.length > 0) {
            await appendToSheet(`${sheetName}!A:Z`, [rowData], env);
            itemSummary.push(`${it.claimType}: RM${it.amount}`);
          }
        }
        await sendTelegramNotification(env, `🧾 NEW CLAIM REQUEST\nName: ${fullName}\nEmail: ${email}\nDate: ${claimDate}\nItems: ${itemSummary.join(', ')}\nStatus: PENDING`);
        await sendEmailToHR(env, fullName, email, 'Claim', 'Claim Date: ' + claimDate + '\nItems:\n' + itemSummary.join('\n'));
        return Response.json({ success: true });
      } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
    }
    
    // Upload receipt
    if (path === '/api/upload-receipt' && method === 'POST') {
      try {
        await ensureAllSheetsExist(env);
        const formData = await request.formData();
        const email = formData.get('email');
        const fullName = formData.get('fullName');
        const receiptType = formData.get('receiptType');
        const description = formData.get('description') || '';
        const file = formData.get('file');
        if (!email || !fullName || !receiptType || !file) throw new Error('Incomplete data');
        const valid = await isStaffValid(email, env);
        if (!valid) return Response.json({ error: 'Email not registered' }, { status: 400 });
        let fileUrl = '';
        try {
          const ext = file.name.split('.').pop();
          const fileName = `receipt_${Date.now()}_${email.replace(/[^a-z0-9]/gi, '_')}.${ext}`;
          fileUrl = await uploadToDrive(file, fileName, file.type, env);
        } catch (uploadErr) { fileUrl = `UPLOAD_FAILED: ${uploadErr.message}`; }
        await appendToSheet('Receipts!A:G', [[formatTimestamp(), email, fullName, receiptType, fileUrl, description, 'pending']], env);
        await sendTelegramNotification(env, `📎 RECEIPT UPLOADED\nName: ${fullName}\nEmail: ${email}\nType: ${receiptType}`);
        return Response.json({ success: true, message: 'Receipt uploaded successfully', fileUrl });
      } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
    }
    
    // Get history
    if (path === '/api/get-history' && method === 'GET') {
      try {
        const email = url.searchParams.get('email');
        if (!email) return Response.json({ error: 'Email required' }, { status: 400 });
        await ensureAllSheetsExist(env);
        const leaves = await readSheet('LeaveRequests!A:K', env);
        const ots = await readSheet('OvertimeRequests!A:K', env);
        const receipts = await readSheet('Receipts!A:G', env);
        
        // Get claims from all claim sheets
        const claimSheets = ['Claims_Hotel', 'Claims_Distance', 'Claims_Meal', 'Claims_TNG', 'Claims_Item'];
        let allClaims = [];
        for (const sheet of claimSheets) {
          const rows = await readSheet(`${sheet}!A:Z`, env);
          if (rows && rows.length > 1) {
            for (const r of rows.slice(1)) {
              if (r[2]?.toLowerCase() === email.toLowerCase()) {
                const statusIndex = r.length - 2;
                const amountIndex = r.length - 3;
                allClaims.push({
                  type: 'Claim',
                  id: r[1] || '',
                  claimType: sheet.replace('Claims_', ''),
                  amount: parseFloat(r[amountIndex]) || 0,
                  claimDate: r[4] || '',
                  status: r[statusIndex] || 'pending',
                  timestamp: r[0] || ''
                });
              }
            }
          }
        }
        
        const history = [
          ...leaves.slice(1).filter(r => r[2] === email).map(r => ({ type: 'Leave', id: r[1], leaveType: r[4], halfDay: r[5], start: r[6], end: r[7], status: r[9], timestamp: r[0] })),
          ...ots.slice(1).filter(r => r[2] === email).map(r => ({ type: 'Overtime', id: r[1], date: r[4], hours: r[5], amount: r[7], status: r[9], timestamp: r[0] })),
          ...allClaims,
          ...receipts.slice(1).filter(r => r[1] === email).map(r => ({ type: 'Receipt', receiptType: r[3], fileUrl: r[4], description: r[5], status: r[6], timestamp: r[0] }))
        ];
        return Response.json({ success: true, history });
      } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
    }
    
    // Delete request
    if (path === '/api/delete-request' && method === 'POST') {
      try {
        const { requestId, type, email } = await request.json();
        if (!requestId || !type || !email) return Response.json({ error: 'Missing parameters' }, { status: 400 });
        const valid = await isStaffValid(email, env);
        if (!valid) return Response.json({ error: 'Unauthorized' }, { status: 403 });
        const token = await getGoogleAccessToken(env);
        const spreadsheetId = env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
        
        async function deleteRows(sheetName, rowsToDeleteIndices) {
          const spreadsheet = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, { headers: { 'Authorization': `Bearer ${token}` } });
          const sheetData = await spreadsheet.json();
          const sheet = sheetData.sheets.find(s => s.properties.title === sheetName);
          if (!sheet) throw new Error(`Sheet ${sheetName} not found`);
          const sheetId = sheet.properties.sheetId;
          rowsToDeleteIndices.sort((a,b) => b - a);
          const deleteRequests = rowsToDeleteIndices.map(rowIndex => ({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowIndex - 1, endIndex: rowIndex } } }));
          const batchRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: deleteRequests }) });
          if (!batchRes.ok) throw new Error(`Batch delete failed`);
          return true;
        }
        
        if (type === 'Leave') {
          const rows = await readSheet('LeaveRequests!A:K', env);
          const rowIndex = rows.slice(1).findIndex(r => r[1] === requestId);
          if (rowIndex === -1) return Response.json({ error: 'Not found' }, { status: 404 });
          const actualRow = rowIndex + 2;
          if (rows[rowIndex+1][2] !== email) return Response.json({ error: 'Not your request' }, { status: 403 });
          await deleteRows('LeaveRequests', [actualRow]);
        } else if (type === 'Overtime') {
          const rows = await readSheet('OvertimeRequests!A:K', env);
          const rowIndex = rows.slice(1).findIndex(r => r[1] === requestId);
          if (rowIndex === -1) return Response.json({ error: 'Not found' }, { status: 404 });
          const actualRow = rowIndex + 2;
          if (rows[rowIndex+1][2] !== email) return Response.json({ error: 'Not your request' }, { status: 403 });
          await deleteRows('OvertimeRequests', [actualRow]);
        } else if (type === 'Claim') {
          const claimSheets = ['Claims_Hotel', 'Claims_Distance', 'Claims_Meal', 'Claims_TNG', 'Claims_Item'];
          let deleted = false;
          for (const sheet of claimSheets) {
            const rows = await readSheet(`${sheet}!A:Z`, env);
            if (!rows || rows.length < 2) continue;
            const indicesToDelete = [];
            for (let i = 1; i < rows.length; i++) {
              if (rows[i][1] && rows[i][1].startsWith(requestId) && rows[i][2] === email) {
                indicesToDelete.push(i+1);
              }
            }
            if (indicesToDelete.length > 0) {
              await deleteRows(sheet, indicesToDelete);
              deleted = true;
            }
          }
          if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 });
        } else {
          return Response.json({ error: 'Unsupported type' }, { status: 400 });
        }
        return Response.json({ success: true });
      } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
    }
    
    // Approve/Reject request
    if (path === '/api/approve-request' && method === 'POST') {
      try {
        const { type, requestId, status } = await request.json();
        
        if (type === 'leave') {
          const rows = await readSheet('LeaveRequests!A:K', env);
          const rowIndex = rows.slice(1).findIndex(r => r[1] === requestId);
          if (rowIndex === -1) return Response.json({ error: 'Not found' }, { status: 404 });
          const actualRow = rowIndex + 2;
          const requestData = rows[rowIndex+1];
          await updateSheet(`LeaveRequests!J${actualRow}`, [[status]], env);
          if (status === 'approved') {
            const daysUsed = calculateLeaveDays(requestData[6], requestData[7], requestData[5]) || 0;
            const userBalance = await getUserLeaveBalance(requestData[2], env);
            if (userBalance) await updateLeaveBalance(requestData[2], userBalance.balance - daysUsed, env);
          }
          const statusText = status === 'approved' ? '✅ APPROVED' : '❌ REJECTED';
          await sendTelegramNotification(env, `✏️ LEAVE ${statusText}\nName: ${requestData[3]}\nEmail: ${requestData[2]}\nDate: ${requestData[6]} → ${requestData[7]}`);
          if (status === 'approved' || status === 'rejected') {
            const subject = status === 'approved' ? '✅ Your Leave Has Been Approved' : '❌ Your Leave Has Been Rejected';
            const html = `<h2>${subject}</h2><p>Dear ${requestData[3]},</p><p>Your ${requestData[4]} leave request from ${requestData[6]} to ${requestData[7]} has been <strong>${status === 'approved' ? 'APPROVED' : 'REJECTED'}</strong>.</p><br><p>Thank you,<br>Versafac HR Team</p>`;
            await sendEmailNotification(env, requestData[2], subject, html);
          }
        } else if (type === 'overtime') {
          const rows = await readSheet('OvertimeRequests!A:K', env);
          const rowIndex = rows.slice(1).findIndex(r => r[1] === requestId);
          if (rowIndex === -1) return Response.json({ error: 'Not found' }, { status: 404 });
          const actualRow = rowIndex + 2;
          const requestData = rows[rowIndex+1];
          await updateSheet(`OvertimeRequests!J${actualRow}`, [[status]], env);
          const statusText = status === 'approved' ? '✅ APPROVED' : '❌ REJECTED';
          await sendTelegramNotification(env, `⏰ OVERTIME ${statusText}\nName: ${requestData[3]}\nEmail: ${requestData[2]}\nHours: ${requestData[5]}h\nAmount: RM${requestData[7]}`);
          if (status === 'approved' || status === 'rejected') {
            const subject = status === 'approved' ? '✅ Your Overtime Has Been Approved' : '❌ Your Overtime Has Been Rejected';
            const html = `<h2>${subject}</h2>
              <p>Dear ${requestData[3]},</p>
              <p>Your overtime request on ${requestData[4]} for ${requestData[5]} hours (RM${requestData[7]}) has been <strong>${status === 'approved' ? 'APPROVED' : 'REJECTED'}</strong>.</p>
              <br><p>Thank you,<br>Versafac HR Team</p>`;
            await sendEmailNotification(env, requestData[2], subject, html);
          }
        } else if (type === 'claim') {
          // Handle claim approval - find in all claim sheets
          const claimSheets = ['Claims_Hotel', 'Claims_Distance', 'Claims_Meal', 'Claims_TNG', 'Claims_Item'];
          let found = false;
          let firstRowData = null;
          let totalAmount = 0;
          
          for (const sheet of claimSheets) {
            const rows = await readSheet(`${sheet}!A:Z`, env);
            if (!rows || rows.length < 2) continue;
            const indices = [];
            for (let i = 1; i < rows.length; i++) {
              if (rows[i][1] && (rows[i][1] === requestId || rows[i][1].startsWith(requestId + '_'))) {
                indices.push(i+1);
                if (!firstRowData) firstRowData = rows[i];
                totalAmount = totalAmount + (parseFloat(rows[i][rows[i].length - 3]) || 0);
              }
            }
            for (const rowIdx of indices) {
              const lastCol = String.fromCharCode(64 + rows[0].length);
              await updateSheet(`${sheet}!${lastCol}${rowIdx}`, [[status]], env);
              found = true;
            }
          }
          
          if (!found) return Response.json({ error: 'Not found' }, { status: 404 });
          
          const statusText = status === 'approved' ? '✅ APPROVED' : '❌ REJECTED';
          await sendTelegramNotification(env, `🧾 CLAIM ${statusText}\nName: ${firstRowData ? firstRowData[3] : 'Unknown'}\nEmail: ${firstRowData ? firstRowData[2] : 'Unknown'}\nTotal: RM${totalAmount}`);
          if (status === 'approved' || status === 'rejected') {
            const subject = status === 'approved' ? '✅ Your Claim Has Been Approved' : '❌ Your Claim Has Been Rejected';
            const html = `<h2>${subject}</h2>
              <p>Dear ${firstRowData ? firstRowData[3] : 'Staff'},</p>
              <p>Your claim on ${firstRowData ? firstRowData[4] : ''} with total amount RM${totalAmount} has been <strong>${status === 'approved' ? 'APPROVED' : 'REJECTED'}</strong>.</p>
              <br><p>Thank you,<br>Versafac HR Team</p>`;
            await sendEmailNotification(env, firstRowData ? firstRowData[2] : '', subject, html);
          }
        }
        return Response.json({ success: true });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }
    
    // Approve/Reject receipt
if (path === '/api/approve-receipt' && method === 'POST') {
  try {
    const { requestId, status } = await request.json();
    const rows = await readSheet('Receipts!A:G', env);
    const rowIndex = rows.slice(1).findIndex(r => (r[0] || '') === requestId);
    if (rowIndex === -1) return Response.json({ error: 'Not found' }, { status: 404 });
    const actualRow = rowIndex + 2;
    await updateSheet(`Receipts!G${actualRow}`, [[status]], env);
    const requestData = rows[rowIndex+1];
    await sendTelegramNotification(env, `📎 RECEIPT ${status === 'approved' ? '✅ APPROVED' : '❌ REJECTED'}\nName: ${requestData[2]}\nEmail: ${requestData[1]}\nType: ${requestData[3]}`);
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
    
    // Update settings
    if (path === '/api/update-settings' && method === 'POST') {
      try {
        const { distanceRate, hotelRate, otRateWeekday, otRateSaturday, otRateSunday } = await request.json();
        if (distanceRate !== undefined) await updateSetting('distanceRate', distanceRate, env);
        if (hotelRate !== undefined) await updateSetting('hotelRate', hotelRate, env);
        if (otRateWeekday !== undefined) await updateSetting('otRateWeekday', otRateWeekday, env);
        if (otRateSaturday !== undefined) await updateSetting('otRateSaturday', otRateSaturday, env);
        if (otRateSunday !== undefined) await updateSetting('otRateSunday', otRateSunday, env);
        return Response.json({ success: true });
      } catch (e) { return Response.json({ success: false, error: e.message }); }
    }
    
    // Update employee
    if (path === '/api/update-employee' && method === 'POST') {
      try {
        const { oldEmail, newEmail, newName, annualLeave } = await request.json();
        if (oldEmail !== newEmail) {
          await updateEmployeeEmail(oldEmail, newEmail, newName, env);
        } else {
          await updateEmployeeNameAndLeave(newEmail, newName, parseFloat(annualLeave), env);
        }
        return Response.json({ success: true });
      } catch (e) { return Response.json({ success: false, error: e.message }); }
    }
    
    // Add employee
    if (path === '/api/add-employee' && method === 'POST') {
      try {
        const { email, name, annualLeave } = await request.json();
        const existing = await isStaffValid(email, env);
        if (existing) return Response.json({ success: false, error: 'Email already exists' });
        await addNewEmployee(email, name, parseFloat(annualLeave) || 0, env);
        return Response.json({ success: true });
      } catch (e) { return Response.json({ success: false, error: e.message }); }
    }
    
    // Export report
    if (path === '/api/export-report' && method === 'GET') {
      const year = parseInt(url.searchParams.get('year')) || new Date().getFullYear();
      const month = parseInt(url.searchParams.get('month')) || new Date().getMonth() + 1;
      const lang = url.searchParams.get('lang') || 'ms';
      const html = await generateMonthlyReport(env, year, month, lang);
      return new Response(html, { headers: { 'Content-Type': 'text/html', 'Content-Disposition': `attachment; filename="report_${year}_${month}.html"` } });
    }
    
    // Get leave calendar
    if (path === '/api/get-leave-calendar' && method === 'GET') {
      const year = parseInt(url.searchParams.get('year'));
      const month = parseInt(url.searchParams.get('month'));
      const leaves = await readSheet('LeaveRequests!A:K', env);
      const employees = await getAllEmployees(env);
      const empMap = new Map();
      for (const emp of employees) {
        empMap.set(emp.email, emp.name);
      }
      const approvedLeaves = [];
      for (let i = 1; i < leaves.length; i++) {
        const r = leaves[i];
        if (r[9] === 'approved') {
          approvedLeaves.push({
            name: empMap.get(r[2]) || r[3],
            email: r[2],
            type: r[4],
            start: r[6],
            end: r[7]
          });
        }
      }
      return Response.json({ success: true, leaves: approvedLeaves });
    }
    
    return new Response('Not Found', { status: 404 });
  }
};
