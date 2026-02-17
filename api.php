<?php
/**
 * api.php - Premium SMS Receiver API
 * Pure API endpoint - No HTML output
 * 
 * Author: SMS Monitor System
 * Version: 2.0
 * Security Level: Premium
 */

// ==================== CONFIGURATION ====================
define('DB_FILE', 'sms_database.db');

// ==================== SECURITY HEADERS ====================
header("X-Frame-Options: DENY");
header("X-XSS-Protection: 1; mode=block");
header("X-Content-Type-Options: nosniff");
header("Referrer-Policy: strict-origin-when-cross-origin");
header("Content-Security-Policy: default-src 'self'");

// ==================== ERROR HANDLING ====================
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);
ini_set('error_log', 'error_log.txt');

// ==================== SESSION MANAGEMENT ====================
session_start();
session_regenerate_id(true);

// ==================== DATABASE INITIALIZATION ====================
function initDatabase() {
    if (!file_exists(DB_FILE)) {
        $db = new SQLite3(DB_FILE);
        
        // Create transactions table with status field
        $db->exec("CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT NOT NULL,
            amount TEXT,
            transaction_id TEXT UNIQUE,
            account_number TEXT,
            reference TEXT,
            service_type TEXT,
            transaction_type TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            sim_info TEXT,
            original_message TEXT,
            ip_address TEXT,
            device_info TEXT,
            status TEXT DEFAULT 'PENDING',
            verified_at DATETIME NULL,
            verified_by TEXT NULL
        )");
        
        // Create backup SMS table
        $db->exec("CREATE TABLE IF NOT EXISTS backup_sms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sms_data TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            ip_address TEXT
        )");
        
        // Create indexes for better performance
        $db->exec("CREATE INDEX IF NOT EXISTS idx_transactions_time ON transactions(timestamp)");
        $db->exec("CREATE INDEX IF NOT EXISTS idx_transactions_service ON transactions(service_type)");
        $db->exec("CREATE INDEX IF NOT EXISTS idx_transactions_id ON transactions(transaction_id)");
        $db->exec("CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status)");
        
        $db->close();
    } else {
        // Check if status column exists, if not add it
        $db = new SQLite3(DB_FILE);
        $result = $db->query("PRAGMA table_info(transactions)");
        $hasStatus = false;
        while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
            if ($row['name'] == 'status') {
                $hasStatus = true;
                break;
            }
        }
        if (!$hasStatus) {
            $db->exec("ALTER TABLE transactions ADD COLUMN status TEXT DEFAULT 'PENDING'");
            $db->exec("ALTER TABLE transactions ADD COLUMN verified_at DATETIME NULL");
            $db->exec("ALTER TABLE transactions ADD COLUMN verified_by TEXT NULL");
        }
        $db->close();
    }
}

// ==================== SECURITY FUNCTIONS ====================
function sanitizeInput($input) {
    if (is_array($input)) {
        return array_map('sanitizeInput', $input);
    }
    return htmlspecialchars(strip_tags(trim($input)), ENT_QUOTES, 'UTF-8');
}

function getClientIP() {
    $ip = $_SERVER['HTTP_CLIENT_IP'] ??   
          $_SERVER['HTTP_X_FORWARDED_FOR'] ??   
          $_SERVER['REMOTE_ADDR'] ??   
          '0.0.0.0';
    
    // Handle multiple IPs in X-Forwarded-For
    if (strpos($ip, ',') !== false) {
        $ips = explode(',', $ip);
        $ip = trim($ips[0]);
    }
    
    return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : '0.0.0.0';
}

// ==================== API HANDLERS ====================
function handleSaveTransaction($data, $ip) {
    if (!file_exists(DB_FILE)) {
        initDatabase();
    }
    
    $db = new SQLite3(DB_FILE);
    
    $transaction = json_decode($data, true);
    if (!$transaction) {
        return ['success' => false, 'error' => 'Invalid JSON data'];
    }
    
    // Check if transaction with same ID already exists
    if (!empty($transaction['transaction_id'])) {
        $checkStmt = $db->prepare("SELECT id, status FROM transactions WHERE transaction_id = ?");
        $checkStmt->bindValue(1, $transaction['transaction_id'], SQLITE3_TEXT);
        $checkResult = $checkStmt->execute();
        $existing = $checkResult->fetchArray(SQLITE3_ASSOC);
        
        if ($existing) {
            $db->close();
            return [
                'success' => true, 
                'message' => 'Transaction already exists',
                'status' => $existing['status']
            ];
        }
    }
    
    $stmt = $db->prepare("INSERT INTO transactions 
        (sender, amount, transaction_id, account_number, reference, service_type, 
         transaction_type, sim_info, original_message, ip_address, device_info, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')");
    
    $stmt->bindValue(1, sanitizeInput($transaction['sender'] ?? ''), SQLITE3_TEXT);
    $stmt->bindValue(2, sanitizeInput($transaction['amount'] ?? ''), SQLITE3_TEXT);
    $stmt->bindValue(3, sanitizeInput($transaction['transaction_id'] ?? ''), SQLITE3_TEXT);
    $stmt->bindValue(4, sanitizeInput($transaction['account_number'] ?? ''), SQLITE3_TEXT);
    $stmt->bindValue(5, sanitizeInput($transaction['reference'] ?? ''), SQLITE3_TEXT);
    $stmt->bindValue(6, sanitizeInput($transaction['service_type'] ?? ''), SQLITE3_TEXT);
    $stmt->bindValue(7, sanitizeInput($transaction['transaction_type'] ?? ''), SQLITE3_TEXT);
    $stmt->bindValue(8, sanitizeInput($transaction['sim_info'] ?? ''), SQLITE3_TEXT);
    $stmt->bindValue(9, sanitizeInput($transaction['original_message'] ?? ''), SQLITE3_TEXT);
    $stmt->bindValue(10, $ip, SQLITE3_TEXT);
    $stmt->bindValue(11, $_SERVER['HTTP_USER_AGENT'] ?? 'Unknown', SQLITE3_TEXT);
    
    try {
        $stmt->execute();
        return ['success' => true, 'message' => 'Transaction saved as PENDING'];
    } catch (Exception $e) {
        return ['success' => false, 'error' => 'Database error: ' . $e->getMessage()];
    } finally {
        $db->close();
    }
}

function handleSaveBackup($smsData, $ip) {
    if (!file_exists(DB_FILE)) {
        initDatabase();
    }
    
    $db = new SQLite3(DB_FILE);
    
    $stmt = $db->prepare("INSERT INTO backup_sms (sms_data, ip_address) VALUES (?, ?)");
    $stmt->bindValue(1, sanitizeInput($smsData), SQLITE3_TEXT);
    $stmt->bindValue(2, $ip, SQLITE3_TEXT);
    
    try {
        $stmt->execute();
        return ['success' => true];
    } catch (Exception $e) {
        return ['success' => false, 'error' => $e->getMessage()];
    } finally {
        $db->close();
    }
}

function getStatistics() {
    if (!file_exists(DB_FILE)) {
        return [
            'total_transactions' => 0,
            'today_transactions' => 0,
            'total_amount' => '0.00',
            'service_distribution' => [],
            'recent_transactions' => [],
            'pending_transactions' => 0,
            'completed_transactions' => 0
        ];
    }
    
    $db = new SQLite3(DB_FILE);
    
    $stats = [];
    
    // Total transactions
    $result = $db->query("SELECT COUNT(*) as total FROM transactions");
    $stats['total_transactions'] = $result->fetchArray(SQLITE3_ASSOC)['total'];
    
    // Today's transactions
    $result = $db->query("SELECT COUNT(*) as today FROM transactions WHERE date(timestamp) = date('now')");
    $stats['today_transactions'] = $result->fetchArray(SQLITE3_ASSOC)['today'];
    
    // Pending transactions
    $result = $db->query("SELECT COUNT(*) as pending FROM transactions WHERE status = 'PENDING'");
    $stats['pending_transactions'] = $result->fetchArray(SQLITE3_ASSOC)['pending'];
    
    // Completed transactions
    $result = $db->query("SELECT COUNT(*) as completed FROM transactions WHERE status = 'COMPLETED'");
    $stats['completed_transactions'] = $result->fetchArray(SQLITE3_ASSOC)['completed'];
    
    // Total amount (estimate)
    $result = $db->query("SELECT SUM(CAST(replace(replace(amount, ',', ''), 'Tk', '') AS REAL)) as total_amount FROM transactions WHERE amount != '' AND status = 'COMPLETED'");
    $stats['total_amount'] = number_format($result->fetchArray(SQLITE3_ASSOC)['total_amount'] ?? 0, 2);
    
    // Service distribution
    $result = $db->query("SELECT service_type, COUNT(*) as count FROM transactions WHERE status = 'COMPLETED' GROUP BY service_type ORDER BY count DESC");
    $stats['service_distribution'] = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $stats['service_distribution'][] = $row;
    }
    
    // Recent transactions
    $result = $db->query("SELECT * FROM transactions ORDER BY timestamp DESC LIMIT 20");
    $stats['recent_transactions'] = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $stats['recent_transactions'][] = $row;
    }
    
    $db->close();
    return $stats;
}

// ==================== API STATUS CHECK ====================
if ($_SERVER['REQUEST_METHOD'] === 'GET' && !isset($_GET['action'])) {
    header('Content-Type: application/json');
    echo json_encode([
        'status' => 'running',
        'message' => 'API is running successfully',
        'timestamp' => date('Y-m-d H:i:s'),
        'version' => '2.0'
    ]);
    exit;
}

// ==================== MAIN REQUEST HANDLER ====================
initDatabase();
$ip = getClientIP();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'POST') {
    header('Content-Type: application/json');

    $action = $_POST['action'] ?? '';

    switch ($action) {
        case 'save_transaction':
            $data = $_POST['data'] ?? '';
            echo json_encode(handleSaveTransaction($data, $ip));
            break;

        case 'save_backup':
            $smsData = $_POST['sms_data'] ?? '';
            echo json_encode(handleSaveBackup($smsData, $ip));
            break;

        case 'get_stats':
            echo json_encode(getStatistics());
            break;

        case 'verify_payment':
            $service = trim($_POST['service'] ?? '');
            $amount  = trim($_POST['amount'] ?? '');
            $txid    = trim($_POST['txid'] ?? '');

            if ($service === '' || $amount === '' || $txid === '') {
                echo json_encode([
                    "success" => false,
                    "error"   => "Missing service, amount or transaction ID (txid)"
                ]);
                break;
            }

            $db = new SQLite3(DB_FILE);

            // First check if transaction exists and is already COMPLETED
            $checkStmt = $db->prepare("
                SELECT id, status 
                FROM transactions 
                WHERE LOWER(service_type) = LOWER(?) 
                  AND transaction_id = ?
            ");
            $checkStmt->bindValue(1, $service, SQLITE3_TEXT);
            $checkStmt->bindValue(2, $txid, SQLITE3_TEXT);
            $checkRes = $checkStmt->execute()->fetchArray(SQLITE3_ASSOC);
            
            if ($checkRes && $checkRes['status'] === 'COMPLETED') {
                $db->close();
                echo json_encode([
                    "success" => false,
                    "error" => "ALREADY_COMPLETED",
                    "message" => "This transaction has already been verified and completed"
                ]);
                break;
            }
            
            // Now verify the transaction (only PENDING ones can be verified)
            $stmt = $db->prepare("
                SELECT id, status
                FROM transactions
                WHERE LOWER(service_type) = LOWER(?)
                  AND transaction_id = ?
                  AND status = 'PENDING'
                  AND CAST(
                        REPLACE(
                            REPLACE(
                                REPLACE(REPLACE(amount, 'Tk', ''), '৳', ''),
                            ',', ''),
                        ' ', '')
                    AS REAL
                  ) = CAST(? AS REAL)
            ");

            $stmt->bindValue(1, $service, SQLITE3_TEXT);
            $stmt->bindValue(2, $txid, SQLITE3_TEXT);
            
            // Amount normalization
            $clean_amount = preg_replace('/[^0-9.]/', '', $amount);
            $stmt->bindValue(3, $clean_amount, SQLITE3_TEXT);

            $res = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
            
            if ($res && $res['id']) {
                // Update transaction status to COMPLETED
                $updateStmt = $db->prepare("
                    UPDATE transactions 
                    SET status = 'COMPLETED', 
                        verified_at = CURRENT_TIMESTAMP,
                        verified_by = ?
                    WHERE id = ?
                ");
                $updateStmt->bindValue(1, $_SERVER['REMOTE_ADDR'] ?? 'API', SQLITE3_TEXT);
                $updateStmt->bindValue(2, $res['id'], SQLITE3_INTEGER);
                $updateStmt->execute();
                
                $db->close();
                echo json_encode([
                    "success" => true,
                    "matched_records" => 1,
                    "message" => "Transaction verified and marked as COMPLETED",
                    "status" => "COMPLETED"
                ]);
            } else {
                // Check if exists but not PENDING
                $pendingCheck = $db->prepare("
                    SELECT COUNT(*) as total, status
                    FROM transactions
                    WHERE LOWER(service_type) = LOWER(?)
                      AND transaction_id = ?
                ");
                $pendingCheck->bindValue(1, $service, SQLITE3_TEXT);
                $pendingCheck->bindValue(2, $txid, SQLITE3_TEXT);
                $pendingRes = $pendingCheck->execute()->fetchArray(SQLITE3_ASSOC);
                
                if ($pendingRes && $pendingRes['total'] > 0) {
                    $db->close();
                    echo json_encode([
                        "success" => false,
                        "error" => "TRANSACTION_NOT_PENDING",
                        "message" => "Transaction found but not in PENDING state"
                    ]);
                } else {
                    $db->close();
                    echo json_encode([
                        "success" => false,
                        "error" => "NO_MATCH",
                        "message" => "No matching PENDING transaction found"
                    ]);
                }
            }
            break;
            
        case 'verify_payment_without_txid':
            $service = trim($_POST['service'] ?? '');
            $amount  = trim($_POST['amount'] ?? '');

            if ($service === '' || $amount === '') {
                echo json_encode([
                    "success" => false,
                    "error"   => "Missing service or amount"
                ]);
                break;
            }

            $db = new SQLite3(DB_FILE);

            // Only get PENDING transactions
            $stmt = $db->prepare("
                SELECT id, transaction_id
                FROM transactions
                WHERE LOWER(service_type) = LOWER(?)
                  AND status = 'PENDING'
                  AND CAST(
                        REPLACE(
                            REPLACE(
                                REPLACE(REPLACE(amount, 'Tk', ''), '৳', ''),
                            ',', ''),
                        ' ', '')
                    AS REAL
                  ) = CAST(? AS REAL)
                ORDER BY timestamp DESC
                LIMIT 1
            ");

            $stmt->bindValue(1, $service, SQLITE3_TEXT);
            
            $clean_amount = preg_replace('/[^0-9.]/', '', $amount);
            $stmt->bindValue(2, $clean_amount, SQLITE3_TEXT);

            $res = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
            
            if ($res && $res['id']) {
                // Update transaction status to COMPLETED
                $updateStmt = $db->prepare("
                    UPDATE transactions 
                    SET status = 'COMPLETED', 
                        verified_at = CURRENT_TIMESTAMP,
                        verified_by = ?
                    WHERE id = ?
                ");
                $updateStmt->bindValue(1, $_SERVER['REMOTE_ADDR'] ?? 'API', SQLITE3_TEXT);
                $updateStmt->bindValue(2, $res['id'], SQLITE3_INTEGER);
                $updateStmt->execute();
                
                $db->close();
                echo json_encode([
                    "success" => true,
                    "matched_records" => 1,
                    "transaction_id" => $res['transaction_id'],
                    "message" => "Transaction verified and marked as COMPLETED",
                    "status" => "COMPLETED"
                ]);
            } else {
                $db->close();
                echo json_encode([
                    "success" => false,
                    "error" => "NO_MATCH",
                    "message" => "No matching PENDING transaction found"
                ]);
            }
            break;
            
        case 'check_transaction_status':
            $txid = trim($_POST['txid'] ?? '');
            
            if ($txid === '') {
                echo json_encode([
                    "success" => false,
                    "error" => "Missing transaction ID"
                ]);
                break;
            }
            
            $db = new SQLite3(DB_FILE);
            $stmt = $db->prepare("SELECT status, verified_at FROM transactions WHERE transaction_id = ?");
            $stmt->bindValue(1, $txid, SQLITE3_TEXT);
            $res = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
            $db->close();
            
            if ($res) {
                echo json_encode([
                    "success" => true,
                    "status" => $res['status'],
                    "verified_at" => $res['verified_at']
                ]);
            } else {
                echo json_encode([
                    "success" => false,
                    "error" => "Transaction not found"
                ]);
            }
            break;
            
        case 'clear_database':
            if (file_exists(DB_FILE) && unlink(DB_FILE)) {
                echo json_encode([
                    "success" => true,
                    "message" => "Database cleared successfully"
                ]);
            } else {
                echo json_encode([
                    "success" => false,
                    "error"   => "Database not found or delete failed"
                ]);
            }
            break;

        default:
            http_response_code(400);
            echo json_encode([
                "success" => false,
                "error"   => "Invalid action"
            ]);
    }

    exit;
}

// If no valid request method found
http_response_code(405);
header('Content-Type: application/json');
echo json_encode([
    'status' => 'error',
    'message' => 'Method not allowed'
]);
?> 