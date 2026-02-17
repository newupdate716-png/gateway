<?php
/**
 * index.php - Premium SMS Monitor Web Dashboard
 * HTML Interface for viewing transactions
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
header("Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; font-src 'self' https://cdnjs.cloudflare.com;");

// ==================== ERROR HANDLING ====================
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);
ini_set('error_log', 'error_log.txt');

// ==================== SESSION MANAGEMENT ====================
session_start();
session_regenerate_id(true);

// ==================== DATABASE FUNCTIONS ====================
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

// Get statistics for display
$stats = getStatistics();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>💎 Premium SMS Monitor Dashboard</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root {
            --primary: #8B5CF6;
            --secondary: #10B981;
            --danger: #EF4444;
            --warning: #F59E0B;
            --info: #3B82F6;
            --dark: #1F2937;
            --light: #F9FAFB;
            --gray: #6B7280;
            --bkash: #E2136E;
            --nagad: #F8A61C;
            --rocket: #4CAF50;
            --bank: #3B82F6;
            --border: #E5E7EB;
            --pending: #F59E0B;
            --completed: #10B981;
        }
        
        * { 
            margin: 0; 
            padding: 0; 
            box-sizing: border-box; 
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        }
        
        body { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: var(--dark);
            line-height: 1.6;
        }
        
        .dashboard {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }
        
        /* Header Styles */
        .header {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 25px 30px;
            margin-bottom: 25px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
            border: 1px solid rgba(255, 255, 255, 0.3);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .header-left {
            display: flex;
            align-items: center;
            gap: 20px;
        }
        
        .logo {
            width: 60px;
            height: 60px;
            background: linear-gradient(135deg, var(--primary), #7C3AED);
            border-radius: 15px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 28px;
        }
        
        .title h1 {
            font-size: 28px;
            font-weight: 800;
            color: var(--dark);
            margin-bottom: 5px;
        }
        
        .title p {
            color: var(--gray);
            font-size: 14px;
            font-weight: 500;
        }
        
        .badge {
            background: linear-gradient(135deg, var(--secondary), #059669);
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        /* Stats Grid */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 18px;
            padding: 25px;
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
            transition: all 0.3s ease;
            border: 1px solid rgba(255, 255, 255, 0.3);
        }
        
        .stat-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 15px 35px rgba(0, 0, 0, 0.15);
        }
        
        .stat-icon {
            width: 60px;
            height: 60px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            margin-bottom: 20px;
            color: white;
        }
        
        .stat-icon.blue { background: linear-gradient(135deg, #3B82F6, #1D4ED8); }
        .stat-icon.green { background: linear-gradient(135deg, #10B981, #059669); }
        .stat-icon.purple { background: linear-gradient(135deg, #8B5CF6, #7C3AED); }
        .stat-icon.orange { background: linear-gradient(135deg, #F59E0B, #D97706); }
        .stat-icon.yellow { background: linear-gradient(135deg, #FBBF24, #F59E0B); }
        
        .stat-title {
            font-size: 14px;
            color: var(--gray);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
        }
        
        .stat-value {
            font-size: 32px;
            font-weight: 800;
            color: var(--dark);
            margin-bottom: 5px;
        }
        
        .stat-subtitle {
            font-size: 14px;
            color: var(--gray);
            font-weight: 500;
        }
        
        /* Main Content */
        .main-content {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
            border: 1px solid rgba(255, 255, 255, 0.3);
            margin-bottom: 30px;
        }
        
        .section-title {
            font-size: 22px;
            font-weight: 800;
            color: var(--dark);
            margin-bottom: 25px;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .section-title i {
            color: var(--primary);
        }
        
        /* Status Badges */
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
        }
        
        .status-pending {
            background: #FEF3C7;
            color: #92400E;
        }
        
        .status-completed {
            background: #D1FAE5;
            color: #065F46;
        }
        
        /* Action Bar */
        .action-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 25px;
            flex-wrap: wrap;
            gap: 15px;
        }
        
        .search-container {
            position: relative;
            flex-grow: 1;
            max-width: 400px;
        }
        
        .search-input {
            width: 100%;
            padding: 14px 20px 14px 50px;
            border: 2px solid var(--border);
            border-radius: 12px;
            font-size: 15px;
            transition: all 0.3s;
            background: white;
        }
        
        .search-input:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
        }
        
        .search-icon {
            position: absolute;
            left: 20px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--gray);
        }
        
        .filter-buttons {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        
        .filter-btn {
            padding: 12px 20px;
            border: 2px solid var(--border);
            background: white;
            border-radius: 10px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            color: var(--gray);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .filter-btn:hover {
            border-color: var(--primary);
            color: var(--primary);
        }
        
        .filter-btn.active {
            background: var(--primary);
            border-color: var(--primary);
            color: white;
        }
        
        /* Transactions Table */
        .transactions-table {
            overflow-x: auto;
            border-radius: 15px;
            border: 1px solid var(--border);
            background: white;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            min-width: 1200px;
        }
        
        thead {
            background: linear-gradient(135deg, #F9FAFB, #F3F4F6);
        }
        
        th {
            padding: 18px 20px;
            text-align: left;
            font-weight: 700;
            color: var(--dark);
            border-bottom: 2px solid var(--border);
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        td {
            padding: 18px 20px;
            border-bottom: 1px solid var(--border);
            vertical-align: middle;
        }
        
        tr:hover {
            background: #F9FAFB;
        }
        
        tr.status-pending-row {
            background: rgba(245, 158, 11, 0.05);
        }
        
        tr.status-completed-row {
            background: rgba(16, 185, 129, 0.05);
        }
        
        .service-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 700;
            color: white;
        }
        
        .bkash { background: var(--bkash); }
        .nagad { background: var(--nagad); }
        .rocket { background: var(--rocket); }
        .bank { background: var(--bank); }
        .other { background: var(--primary); }
        
        .transaction-id {
            font-family: 'Monaco', 'Courier New', monospace;
            font-weight: 700;
            color: var(--dark);
            font-size: 14px;
        }
        
        .amount {
            font-weight: 800;
            font-size: 18px;
        }
        
        .amount.received { color: var(--secondary); }
        .amount.sent { color: var(--danger); }
        
        .sender-info {
            display: flex;
            flex-direction: column;
        }
        
        .sender-number {
            font-weight: 700;
            color: var(--dark);
        }
        
        .sender-name {
            font-size: 13px;
            color: var(--gray);
            margin-top: 4px;
        }
        
        .balance {
            font-weight: 700;
            color: var(--primary);
            font-size: 16px;
        }
        
        .timestamp {
            color: var(--gray);
            font-size: 14px;
            white-space: nowrap;
        }
        
        .view-btn {
            background: linear-gradient(135deg, var(--primary), #7C3AED);
            color: white;
            border: none;
            padding: 10px 18px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.3s;
        }
        
        .view-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
        }
        
        .no-data {
            text-align: center;
            padding: 60px 20px;
            color: var(--gray);
        }
        
        .no-data i {
            font-size: 60px;
            margin-bottom: 20px;
            color: #E5E7EB;
        }
        
        .no-data h3 {
            font-size: 20px;
            margin-bottom: 10px;
            color: var(--dark);
        }
        
        /* Service Distribution */
        .service-distribution {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 30px;
        }
        
        .service-item {
            background: white;
            padding: 20px;
            border-radius: 12px;
            border: 1px solid var(--border);
            display: flex;
            align-items: center;
            gap: 15px;
            transition: all 0.3s;
        }
        
        .service-item:hover {
            transform: translateY(-3px);
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
        }
        
        .service-icon {
            width: 50px;
            height: 50px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            color: white;
        }
        
        .service-count {
            font-weight: 800;
            font-size: 24px;
            color: var(--dark);
        }
        
        .service-name {
            font-size: 14px;
            color: var(--gray);
            font-weight: 600;
        }
        
        /* Footer */
        .footer {
            text-align: center;
            padding: 25px;
            color: rgba(255, 255, 255, 0.8);
            font-size: 14px;
            margin-top: 20px;
        }
        
        /* Modal Styles */
        .modal-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 1000;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .modal {
            background: white;
            border-radius: 20px;
            width: 100%;
            max-width: 600px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            animation: modalSlide 0.3s ease;
        }
        
        @keyframes modalSlide {
            from { opacity: 0; transform: translateY(-30px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .modal-header {
            padding: 25px 30px;
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .modal-title {
            font-size: 22px;
            font-weight: 800;
            color: var(--dark);
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .close-btn {
            background: none;
            border: none;
            font-size: 24px;
            color: var(--gray);
            cursor: pointer;
            transition: color 0.3s;
        }
        
        .close-btn:hover {
            color: var(--danger);
        }
        
        .modal-body {
            padding: 30px;
        }
        
        .detail-row {
            display: flex;
            justify-content: space-between;
            padding: 16px 0;
            border-bottom: 1px solid var(--border);
        }
        
        .detail-label {
            font-weight: 600;
            color: var(--gray);
            font-size: 15px;
        }
        
        .detail-value {
            font-weight: 600;
            color: var(--dark);
            text-align: right;
            max-width: 60%;
            word-break: break-word;
        }
        
        .sms-preview {
            background: #F9FAFB;
            border-radius: 12px;
            padding: 25px;
            margin-top: 25px;
            border-left: 4px solid var(--primary);
        }
        
        .sms-title {
            font-size: 16px;
            font-weight: 700;
            color: var(--dark);
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .sms-content {
            font-family: 'Monaco', 'Courier New', monospace;
            white-space: pre-wrap;
            background: white;
            padding: 20px;
            border-radius: 8px;
            border: 1px solid var(--border);
            max-height: 300px;
            overflow-y: auto;
            line-height: 1.8;
            font-size: 14px;
        }
        
        /* Responsive */
        @media (max-width: 768px) {
            .header {
                flex-direction: column;
                gap: 20px;
                text-align: center;
            }
            
            .stats-grid {
                grid-template-columns: 1fr;
            }
            
            .action-bar {
                flex-direction: column;
                align-items: stretch;
            }
            
            .search-container {
                max-width: 100%;
            }
            
            .filter-buttons {
                justify-content: center;
            }
            
            .main-content {
                padding: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <!-- Header -->
        <div class="header">
            <div class="header-left">
                <div class="logo">
                    <i class="fas fa-sms"></i>
                </div>
                <div class="title">
                    <h1>💎 Premium SMS Monitor</h1>
                    <p>Real-time SMS Transaction Dashboard • Auto Pending System</p>
                </div>
            </div>
            <div class="badge">
                <i class="fas fa-shield-alt"></i> 100% Secure • Pending → Completed
            </div>
        </div>

        <!-- Stats Grid -->
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon blue">
                    <i class="fas fa-exchange-alt"></i>
                </div>
                <div class="stat-title">Total Transactions</div>
                <div class="stat-value"><?php echo number_format($stats['total_transactions']); ?></div>
                <div class="stat-subtitle">All time transactions</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon yellow">
                    <i class="fas fa-hourglass-half"></i>
                </div>
                <div class="stat-title">Pending</div>
                <div class="stat-value"><?php echo number_format($stats['pending_transactions'] ?? 0); ?></div>
                <div class="stat-subtitle">Awaiting verification</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon green">
                    <i class="fas fa-check-circle"></i>
                </div>
                <div class="stat-title">Completed</div>
                <div class="stat-value"><?php echo number_format($stats['completed_transactions'] ?? 0); ?></div>
                <div class="stat-subtitle">Verified transactions</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon orange">
                    <i class="fas fa-chart-line"></i>
                </div>
                <div class="stat-title">Today's</div>
                <div class="stat-value"><?php echo number_format($stats['today_transactions']); ?></div>
                <div class="stat-subtitle">Transactions today</div>
            </div>
        </div>
        
        <!-- Main Content -->
        <div class="main-content">
            <div class="section-title">
                <i class="fas fa-list"></i> Recent Transactions
            </div>
            
            <div class="action-bar">
                <div class="search-container">
                    <i class="fas fa-search search-icon"></i>
                    <input type="text" class="search-input" placeholder="Search by number, ID, or amount..." id="searchInput">
                </div>
                
                <div class="filter-buttons">
                    <button class="filter-btn active" onclick="filterTransactions('all')">
                        <i class="fas fa-layer-group"></i> All
                    </button>
                    <button class="filter-btn" onclick="filterTransactions('pending')">
                        <i class="fas fa-hourglass-half"></i> Pending
                    </button>
                    <button class="filter-btn" onclick="filterTransactions('completed')">
                        <i class="fas fa-check-circle"></i> Completed
                    </button>
                </div>
            </div>
            
            <div class="transactions-table">
                <?php if (empty($stats['recent_transactions'])): ?>
                    <div class="no-data">
                        <i class="fas fa-inbox"></i>
                        <h3>No transactions found</h3>
                        <p>Transactions will appear here when received via SMS</p>
                    </div>
                <?php else: ?>
                    <table id="transactionsTable">
                        <thead>
                            <tr>
                                <th>Status</th>
                                <th>Service</th>
                                <th>Transaction ID</th>
                                <th>Amount</th>
                                <th>Sender/Receiver</th>
                                <th>Account/Reference</th>
                                <th>Type</th>
                                <th>Time</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($stats['recent_transactions'] as $transaction): 
                                $service = strtolower($transaction['service_type'] ?? 'other');
                                $isReceived = stripos($transaction['transaction_type'] ?? '', 'received') !== false;
                                $status = strtolower($transaction['status'] ?? 'pending');
                                $rowClass = $status === 'completed' ? 'status-completed-row' : 'status-pending-row';
                            ?>
                            <tr class="<?php echo $rowClass; ?>" 
                                data-service="<?php echo htmlspecialchars($service); ?>" 
                                data-status="<?php echo $status; ?>"
                                data-transaction="<?php echo htmlspecialchars(json_encode($transaction)); ?>">
                                <td>
                                    <span class="status-badge status-<?php echo $status; ?>">
                                        <i class="fas fa-<?php echo $status === 'completed' ? 'check-circle' : 'hourglass-half'; ?>"></i>
                                        <?php echo strtoupper($status); ?>
                                    </span>
                                </td>
                                <td>
                                    <span class="service-badge <?php echo $service; ?>">
                                        <?php if ($service == 'bkash'): ?>
                                            <i class="fas fa-mobile-alt"></i>
                                        <?php elseif ($service == 'nagad'): ?>
                                            <i class="fas fa-wallet"></i>
                                        <?php elseif ($service == 'rocket'): ?>
                                            <i class="fas fa-rocket"></i>
                                        <?php elseif ($service == 'bank'): ?>
                                            <i class="fas fa-university"></i>
                                        <?php else: ?>
                                            <i class="fas fa-money-bill"></i>
                                        <?php endif; ?>
                                        <?php echo htmlspecialchars($transaction['service_type'] ?? 'Other'); ?>
                                    </span>
                                </td>
                                <td>
                                    <div class="transaction-id">
                                        <?php echo htmlspecialchars($transaction['transaction_id'] ?? 'N/A'); ?>
                                    </div>
                                </td>
                                <td>
                                    <div class="amount <?php echo $isReceived ? 'received' : 'sent'; ?>">
                                        ৳<?php echo htmlspecialchars($transaction['amount'] ?? '0.00'); ?>
                                    </div>
                                </td>
                                <td>
                                    <div class="sender-info">
                                        <div class="sender-number">
                                            <?php echo htmlspecialchars($transaction['sender'] ?? 'N/A'); ?>
                                        </div>
                                        <?php if (!empty($transaction['account_number'])): ?>
                                        <div class="sender-name">
                                            <?php echo htmlspecialchars($transaction['account_number']); ?>
                                        </div>
                                        <?php endif; ?>
                                    </div>
                                </td>
                                <td>
                                    <div class="balance">
                                        <?php 
                                            $ref = $transaction['reference'] ?? $transaction['account_number'] ?? '';
                                            echo htmlspecialchars($ref ?: 'N/A'); 
                                        ?>
                                    </div>
                                </td>
                                <td>
                                    <?php echo htmlspecialchars($transaction['transaction_type'] ?? 'N/A'); ?>
                                </td>
                                <td>
                                    <div class="timestamp">
                                        <?php echo date('M d, h:i A', strtotime($transaction['timestamp'] ?? 'now')); ?>
                                    </div>
                                </td>
                                <td>
                                    <button class="view-btn" onclick="viewTransaction(<?php echo htmlspecialchars(json_encode($transaction)); ?>)">
                                        <i class="fas fa-eye"></i> View
                                    </button>
                                </td>
                            </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                <?php endif; ?>
            </div>
            
            <!-- Service Distribution -->
            <?php if (!empty($stats['service_distribution'])): ?>
            <div class="section-title" style="margin-top: 40px;">
                <i class="fas fa-chart-pie"></i> Completed Service Distribution
            </div>
            <div class="service-distribution">
                <?php foreach ($stats['service_distribution'] as $service): 
                    $serviceName = strtolower($service['service_type']);
                    $iconClass = '';
                    $bgColor = '';
                    
                    if ($serviceName == 'bkash') {
                        $iconClass = 'fa-mobile-alt';
                        $bgColor = 'background: var(--bkash);';
                    } elseif ($serviceName == 'nagad') {
                        $iconClass = 'fa-wallet';
                        $bgColor = 'background: var(--nagad);';
                    } elseif ($serviceName == 'rocket') {
                        $iconClass = 'fa-rocket';
                        $bgColor = 'background: var(--rocket);';
                    } elseif ($serviceName == 'bank') {
                        $iconClass = 'fa-university';
                        $bgColor = 'background: var(--bank);';
                    } else {
                        $iconClass = 'fa-money-bill';
                        $bgColor = 'background: var(--primary);';
                    }
                ?>
                <div class="service-item">
                    <div class="service-icon" style="<?php echo $bgColor; ?>">
                        <i class="fas <?php echo $iconClass; ?>"></i>
                    </div>
                    <div>
                        <div class="service-count"><?php echo number_format($service['count']); ?></div>
                        <div class="service-name"><?php echo htmlspecialchars($service['service_type']); ?></div>
                    </div>
                </div>
                <?php endforeach; ?>
            </div>
            <?php endif; ?>
        </div>
        
        <!-- Footer -->
        <div class="footer">
            <p>© <?php echo date('Y'); ?> Premium SMS Monitor System • Auto Pending System • Version 2.0</p>
            <p style="margin-top: 10px; font-size: 12px; opacity: 0.7;">
                <i class="fas fa-lock"></i> 100% Secure • Pending until verified • Once completed, cannot be verified again
            </p>
        </div>
    </div>
    
    <!-- Transaction Details Modal -->
    <div class="modal-overlay" id="transactionModal">
        <div class="modal">
            <div class="modal-header">
                <div class="modal-title">
                    <i class="fas fa-receipt"></i> Transaction Details
                </div>
                <button class="close-btn" onclick="closeModal()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body" id="modalBody">
                <!-- Dynamic content will be loaded here -->
            </div>
        </div>
    </div>
    
    <script>
        // Search functionality
        document.getElementById('searchInput').addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase();
            const rows = document.querySelectorAll('#transactionsTable tbody tr');
            
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(searchTerm) ? '' : 'none';
            });
        });
        
        // Filter transactions by status
        function filterTransactions(filter) {
            const rows = document.querySelectorAll('#transactionsTable tbody tr');
            const buttons = document.querySelectorAll('.filter-btn');
            
            buttons.forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            
            rows.forEach(row => {
                if (filter === 'all') {
                    row.style.display = '';
                } else {
                    const status = row.getAttribute('data-status');
                    row.style.display = status === filter ? '' : 'none';
                }
            });
        }
        
        // View transaction details
        function viewTransaction(transaction) {
            const modal = document.getElementById('transactionModal');
            const modalBody = document.getElementById('modalBody');
            
            const isReceived = transaction.transaction_type?.toLowerCase().includes('received');
            const service = transaction.service_type || 'Unknown';
            const status = transaction.status || 'PENDING';
            
            let detailsHTML = `
                <div class="detail-row">
                    <div class="detail-label">Status:</div>
                    <div class="detail-value">
                        <span class="status-badge status-${status.toLowerCase()}">
                            <i class="fas fa-${status.toLowerCase() === 'completed' ? 'check-circle' : 'hourglass-half'}"></i>
                            ${status}
                        </span>
                    </div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Service Provider:</div>
                    <div class="detail-value">
                        <span class="service-badge ${service.toLowerCase()}">
                            <i class="fas fa-${service.toLowerCase() == 'bkash' ? 'mobile-alt' : 
                                           service.toLowerCase() == 'nagad' ? 'wallet' : 
                                           service.toLowerCase() == 'rocket' ? 'rocket' : 
                                           service.toLowerCase() == 'bank' ? 'university' : 'money-bill'}"></i>
                            ${service}
                        </span>
                    </div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Transaction ID:</div>
                    <div class="detail-value" style="font-family: monospace; font-weight: 700;">${transaction.transaction_id || 'N/A'}</div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Amount:</div>
                    <div class="detail-value" style="color: ${isReceived ? 'var(--secondary)' : 'var(--danger)'}; font-size: 20px; font-weight: 800;">
                        ৳${transaction.amount || '0.00'} 
                        <span style="font-size: 14px; color: var(--gray);">(${isReceived ? 'Received' : 'Sent/Payment'})</span>
                    </div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">${isReceived ? 'Sender Number' : 'Receiver'}:</div>
                    <div class="detail-value">${transaction.sender || 'N/A'}</div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Account/Reference:</div>
                    <div class="detail-value">${transaction.account_number || transaction.reference || 'N/A'}</div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Transaction Type:</div>
                    <div class="detail-value">${transaction.transaction_type || 'N/A'}</div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Transaction Time:</div>
                    <div class="detail-value">${new Date(transaction.timestamp).toLocaleString()}</div>
                </div>`;
                
            if (transaction.verified_at) {
                detailsHTML += `
                <div class="detail-row">
                    <div class="detail-label">Verified At:</div>
                    <div class="detail-value">${new Date(transaction.verified_at).toLocaleString()}</div>
                </div>`;
            }
            
            if (transaction.verified_by) {
                detailsHTML += `
                <div class="detail-row">
                    <div class="detail-label">Verified By:</div>
                    <div class="detail-value">${transaction.verified_by}</div>
                </div>`;
            }
            
            detailsHTML += `
                <div class="detail-row">
                    <div class="detail-label">SIM Information:</div>
                    <div class="detail-value">${transaction.sim_info || 'Not Available'}</div>
                </div>
                
                <div class="sms-preview">
                    <div class="sms-title">
                        <i class="fas fa-sms"></i> Original SMS Message
                    </div>
                    <div class="sms-content">${transaction.original_message || 'No original message available'}</div>
                </div>
            `;
            
            modalBody.innerHTML = detailsHTML;
            modal.style.display = 'flex';
        }
        
        // Close modal
        function closeModal() {
            document.getElementById('transactionModal').style.display = 'none';
        }
        
        // Close modal when clicking outside
        window.onclick = function(event) {
            const modal = document.getElementById('transactionModal');
            if (event.target === modal) {
                closeModal();
            }
        }
        
        // Auto refresh every 30 seconds
        setInterval(() => {
            fetch('api.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: 'action=get_stats'
            })
            .then(response => response.json())
            .then(data => {
                // Update stats dynamically
                const statValues = document.querySelectorAll('.stat-value');
                if (statValues.length >= 4) {
                    statValues[0].textContent = new Intl.NumberFormat().format(data.total_transactions || 0);
                    statValues[1].textContent = new Intl.NumberFormat().format(data.pending_transactions || 0);
                    statValues[2].textContent = new Intl.NumberFormat().format(data.completed_transactions || 0);
                    statValues[3].textContent = new Intl.NumberFormat().format(data.today_transactions || 0);
                }
                
                // Reload page if new transactions came in (optional)
                // window.location.reload();
            })
            .catch(error => console.error('Error refreshing:', error));
        }, 30000);
    </script>
</body>
</html> 