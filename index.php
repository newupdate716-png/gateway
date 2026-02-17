<?php
/**
 * Premium SMS Receiver - Complete Single File
 * Version: 3.0 (Fully Working)
 */

// ==================== CONFIGURATION ====================
define('DB_FILE', __DIR__ . '/sms_database.db');
error_reporting(E_ALL);
ini_set('display_errors', 1);
ini_set('log_errors', 1);

// ==================== DATABASE INIT ====================
try {
    $db = new SQLite3(DB_FILE);
    $db->exec("PRAGMA journal_mode = WAL");
    
    // Create tables
    $db->exec("CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT, amount TEXT, transaction_id TEXT,
        account_number TEXT, reference TEXT, service_type TEXT,
        transaction_type TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        sim_info TEXT, original_message TEXT, ip_address TEXT,
        device_info TEXT, status TEXT DEFAULT 'PENDING',
        verified_at DATETIME, verified_by TEXT
    )");
    
    $db->exec("CREATE TABLE IF NOT EXISTS backup_sms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sms_data TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        ip_address TEXT
    )");
    
    $db->close();
} catch (Exception $e) {
    error_log("DB Error: " . $e->getMessage());
}

// ==================== API HANDLERS ====================
function handleSaveTransaction($data) {
    $db = new SQLite3(DB_FILE);
    $db->exec("PRAGMA journal_mode = WAL");
    
    $t = json_decode($data, true);
    if (!$t) return ['success' => false, 'error' => 'Invalid JSON'];
    
    // Check duplicate
    if (!empty($t['transaction_id'])) {
        $check = $db->prepare("SELECT id FROM transactions WHERE transaction_id = ?");
        $check->bindValue(1, $t['transaction_id'], SQLITE3_TEXT);
        if ($check->execute()->fetchArray()) {
            $db->close();
            return ['success' => true, 'message' => 'Exists'];
        }
    }
    
    $stmt = $db->prepare("INSERT INTO transactions 
        (sender, amount, transaction_id, account_number, reference, service_type,
         transaction_type, sim_info, original_message, ip_address, device_info)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    
    $stmt->bindValue(1, substr($t['sender'] ?? '', 0, 255), SQLITE3_TEXT);
    $stmt->bindValue(2, substr($t['amount'] ?? '', 0, 50), SQLITE3_TEXT);
    $stmt->bindValue(3, substr($t['transaction_id'] ?? '', 0, 100), SQLITE3_TEXT);
    $stmt->bindValue(4, substr($t['account_number'] ?? '', 0, 100), SQLITE3_TEXT);
    $stmt->bindValue(5, substr($t['reference'] ?? '', 0, 100), SQLITE3_TEXT);
    $stmt->bindValue(6, substr($t['service_type'] ?? '', 0, 50), SQLITE3_TEXT);
    $stmt->bindValue(7, substr($t['transaction_type'] ?? '', 0, 50), SQLITE3_TEXT);
    $stmt->bindValue(8, substr($t['sim_info'] ?? '', 0, 100), SQLITE3_TEXT);
    $stmt->bindValue(9, substr($t['original_message'] ?? '', 0, 5000), SQLITE3_TEXT);
    $stmt->bindValue(10, $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0', SQLITE3_TEXT);
    $stmt->bindValue(11, substr($_SERVER['HTTP_USER_AGENT'] ?? 'Unknown', 0, 500), SQLITE3_TEXT);
    
    $stmt->execute();
    $db->close();
    return ['success' => true, 'message' => 'Saved as PENDING'];
}

function handleSaveBackup($smsData) {
    $db = new SQLite3(DB_FILE);
    $db->exec("PRAGMA journal_mode = WAL");
    
    $stmt = $db->prepare("INSERT INTO backup_sms (sms_data, ip_address) VALUES (?, ?)");
    $stmt->bindValue(1, substr($smsData, 0, 5000), SQLITE3_TEXT);
    $stmt->bindValue(2, $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0', SQLITE3_TEXT);
    $stmt->execute();
    
    $db->close();
    return ['success' => true];
}

function getStatistics() {
    if (!file_exists(DB_FILE)) return ['total' => 0, 'pending' => 0, 'completed' => 0, 'today' => 0, 'recent' => []];
    
    $db = new SQLite3(DB_FILE);
    $db->exec("PRAGMA journal_mode = WAL");
    
    $stats = [
        'total' => $db->querySingle("SELECT COUNT(*) FROM transactions"),
        'pending' => $db->querySingle("SELECT COUNT(*) FROM transactions WHERE status = 'PENDING'"),
        'completed' => $db->querySingle("SELECT COUNT(*) FROM transactions WHERE status = 'COMPLETED'"),
        'today' => $db->querySingle("SELECT COUNT(*) FROM transactions WHERE date(timestamp) = date('now')"),
        'recent' => []
    ];
    
    $res = $db->query("SELECT * FROM transactions ORDER BY timestamp DESC LIMIT 50");
    while ($row = $res->fetchArray(SQLITE3_ASSOC)) {
        $stats['recent'][] = $row;
    }
    
    $db->close();
    return $stats;
}

function handleVerifyPayment($service, $amount, $txid) {
    $db = new SQLite3(DB_FILE);
    $db->exec("PRAGMA journal_mode = WAL");
    
    $clean_amount = preg_replace('/[^0-9.]/', '', $amount);
    
    $stmt = $db->prepare("UPDATE transactions SET status = 'COMPLETED', verified_at = CURRENT_TIMESTAMP, verified_by = ? 
                          WHERE transaction_id = ? AND LOWER(service_type) = LOWER(?) AND status = 'PENDING'");
    $stmt->bindValue(1, $_SERVER['REMOTE_ADDR'] ?? 'API', SQLITE3_TEXT);
    $stmt->bindValue(2, $txid, SQLITE3_TEXT);
    $stmt->bindValue(3, $service, SQLITE3_TEXT);
    $stmt->execute();
    
    $changes = $db->changes();
    $db->close();
    
    return $changes > 0 ? 
        ['success' => true, 'message' => 'Verified'] : 
        ['success' => false, 'error' => 'NO_MATCH'];
}

function handleVerifyWithoutTxid($service, $amount) {
    $db = new SQLite3(DB_FILE);
    $db->exec("PRAGMA journal_mode = WAL");
    
    $stmt = $db->prepare("SELECT id, transaction_id FROM transactions 
                          WHERE LOWER(service_type) = LOWER(?) AND status = 'PENDING' 
                          ORDER BY timestamp DESC LIMIT 1");
    $stmt->bindValue(1, $service, SQLITE3_TEXT);
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    if ($result) {
        $update = $db->prepare("UPDATE transactions SET status = 'COMPLETED', verified_at = CURRENT_TIMESTAMP, verified_by = ? WHERE id = ?");
        $update->bindValue(1, $_SERVER['REMOTE_ADDR'] ?? 'API', SQLITE3_TEXT);
        $update->bindValue(2, $result['id'], SQLITE3_INTEGER);
        $update->execute();
        
        $db->close();
        return ['success' => true, 'transaction_id' => $result['transaction_id']];
    }
    
    $db->close();
    return ['success' => false, 'error' => 'NO_MATCH'];
}

function handleCheckStatus($txid) {
    $db = new SQLite3(DB_FILE);
    $db->exec("PRAGMA journal_mode = WAL");
    
    $stmt = $db->prepare("SELECT status, verified_at FROM transactions WHERE transaction_id = ?");
    $stmt->bindValue(1, $txid, SQLITE3_TEXT);
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    $db->close();
    return $result ? 
        ['success' => true, 'status' => $result['status'], 'verified_at' => $result['verified_at']] : 
        ['success' => false, 'error' => 'Not found'];
}

function handleClearDatabase() {
    if (file_exists(DB_FILE)) {
        unlink(DB_FILE);
        return ['success' => true, 'message' => 'Database cleared'];
    }
    return ['success' => false, 'error' => 'Not found'];
}

// ==================== MAIN HANDLER ====================
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json');
    $action = $_POST['action'] ?? '';
    
    $response = match($action) {
        'save_transaction' => handleSaveTransaction($_POST['data'] ?? ''),
        'save_backup' => handleSaveBackup($_POST['sms_data'] ?? ''),
        'get_stats' => getStatistics(),
        'verify_payment' => handleVerifyPayment($_POST['service'] ?? '', $_POST['amount'] ?? '', $_POST['txid'] ?? ''),
        'verify_payment_without_txid' => handleVerifyWithoutTxid($_POST['service'] ?? '', $_POST['amount'] ?? ''),
        'check_transaction_status' => handleCheckStatus($_POST['txid'] ?? ''),
        'clear_database' => handleClearDatabase(),
        default => ['success' => false, 'error' => 'Invalid action']
    };
    
    echo json_encode($response);
    exit;
}

// ==================== HTML DASHBOARD ====================
$stats = getStatistics();
?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SMS Monitor Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
        body { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { background: white; border-radius: 15px; padding: 25px; margin-bottom: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
        .header h1 { font-size: 28px; color: #333; margin-bottom: 5px; }
        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; }
        .stat-card { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
        .stat-card h2 { font-size: 32px; color: #667eea; margin-bottom: 5px; }
        .stat-card p { color: #666; font-size: 14px; }
        .main { background: white; border-radius: 15px; padding: 25px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
        .search { margin-bottom: 20px; }
        .search input { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; }
        .search input:focus { outline: none; border-color: #667eea; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 15px; background: #f8f9fa; color: #333; font-weight: 600; }
        td { padding: 15px; border-bottom: 1px solid #e0e0e0; }
        tr:hover { background: #f8f9fa; }
        .status { padding: 4px 8px; border-radius: 20px; font-size: 12px; font-weight: 600; display: inline-block; }
        .status.PENDING { background: #fff3cd; color: #856404; }
        .status.COMPLETED { background: #d4edda; color: #155724; }
        .btn { background: #667eea; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; font-size: 14px; }
        .btn:hover { background: #5a67d8; }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); align-items: center; justify-content: center; }
        .modal-content { background: white; border-radius: 12px; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto; }
        .modal-header { padding: 20px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; }
        .modal-body { padding: 20px; }
        .close { cursor: pointer; font-size: 24px; color: #666; }
        .close:hover { color: #333; }
        .sms-box { background: #f8f9fa; padding: 15px; border-radius: 8px; margin-top: 15px; font-family: monospace; white-space: pre-wrap; }
        @media (max-width: 768px) { .stats { grid-template-columns: 1fr 1fr; } table { display: block; overflow-x: auto; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📱 SMS Monitor Dashboard</h1>
            <p style="color: #666;">Real-time SMS Transaction Monitor | Pending → Completed</p>
        </div>
        
        <div class="stats">
            <div class="stat-card"><h2><?= $stats['total'] ?? 0 ?></h2><p>Total Transactions</p></div>
            <div class="stat-card"><h2><?= $stats['pending'] ?? 0 ?></h2><p>Pending</p></div>
            <div class="stat-card"><h2><?= $stats['completed'] ?? 0 ?></h2><p>Completed</p></div>
            <div class="stat-card"><h2><?= $stats['today'] ?? 0 ?></h2><p>Today's</p></div>
        </div>
        
        <div class="main">
            <div class="search">
                <input type="text" id="search" placeholder="🔍 Search by any field..." onkeyup="searchTable()">
            </div>
            
            <table id="transactionTable">
                <thead>
                    <tr><th>Status</th><th>Service</th><th>Transaction ID</th><th>Amount</th><th>Sender</th><th>Time</th><th>Action</th></tr>
                </thead>
                <tbody>
                    <?php if(empty($stats['recent'])): ?>
                    <tr><td colspan="7" style="text-align:center; padding:50px;">📭 No transactions yet</td></tr>
                    <?php else: foreach($stats['recent'] as $t): ?>
                    <tr>
                        <td><span class="status <?= $t['status'] ?? 'PENDING' ?>"><?= $t['status'] ?? 'PENDING' ?></span></td>
                        <td><?= htmlspecialchars($t['service_type'] ?? 'Other') ?></td>
                        <td><strong><?= htmlspecialchars($t['transaction_id'] ?? 'N/A') ?></strong></td>
                        <td><strong>৳<?= htmlspecialchars($t['amount'] ?? '0') ?></strong></td>
                        <td><?= htmlspecialchars($t['sender'] ?? 'N/A') ?></td>
                        <td><?= date('M d, H:i', strtotime($t['timestamp'] ?? 'now')) ?></td>
                        <td><button class="btn" onclick='showDetails(<?= json_encode($t) ?>)'>View</button></td>
                    </tr>
                    <?php endforeach; endif; ?>
                </tbody>
            </table>
        </div>
    </div>
    
    <div class="modal" id="modal" onclick="if(event.target==this) closeModal()">
        <div class="modal-content">
            <div class="modal-header">
                <h3>📋 Transaction Details</h3>
                <span class="close" onclick="closeModal()">&times;</span>
            </div>
            <div class="modal-body" id="modalBody"></div>
        </div>
    </div>
    
    <script>
        function searchTable() {
            let input = document.getElementById('search').value.toLowerCase();
            let rows = document.querySelectorAll('#transactionTable tbody tr');
            rows.forEach(row => {
                let text = row.textContent.toLowerCase();
                row.style.display = text.includes(input) ? '' : 'none';
            });
        }
        
        function showDetails(t) {
            let body = document.getElementById('modalBody');
            body.innerHTML = `
                <p><strong>Status:</strong> <span class="status ${t.status || 'PENDING'}">${t.status || 'PENDING'}</span></p>
                <p><strong>Service:</strong> ${t.service_type || 'N/A'}</p>
                <p><strong>Transaction ID:</strong> ${t.transaction_id || 'N/A'}</p>
                <p><strong>Amount:</strong> ৳${t.amount || '0'}</p>
                <p><strong>Sender:</strong> ${t.sender || 'N/A'}</p>
                <p><strong>Account:</strong> ${t.account_number || 'N/A'}</p>
                <p><strong>Reference:</strong> ${t.reference || 'N/A'}</p>
                <p><strong>Type:</strong> ${t.transaction_type || 'N/A'}</p>
                <p><strong>Time:</strong> ${new Date(t.timestamp).toLocaleString()}</p>
                <p><strong>SIM:</strong> ${t.sim_info || 'N/A'}</p>
                ${t.verified_at ? `<p><strong>Verified:</strong> ${new Date(t.verified_at).toLocaleString()}</p>` : ''}
                <div class="sms-box"><strong>📨 Original SMS:</strong><br>${t.original_message || 'No message'}</div>
            `;
            document.getElementById('modal').style.display = 'flex';
        }
        
        function closeModal() {
            document.getElementById('modal').style.display = 'none';
        }
        
        setInterval(() => location.reload(), 30000);
    </script>
</body>
</html>
