// ==================== SMS API ENDPOINT (100% WORKING) ====================
// File location: /api/sms.js

// Simple in-memory database
let memoryDB = {
    transactions: [],
    backup_sms: [],
    stats: {
        total_transactions: 0,
        today_transactions: 0,
        total_amount: '0.00',
        pending_transactions: 0,
        completed_transactions: 0,
        service_distribution: {}
    }
};

// Main handler function
export default async function handler(req, res) {
    console.log('🔥 API called with method:', req.method);
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // Handle GET request for stats (browser testing)
        if (req.method === 'GET') {
            if (req.query.action === 'get_stats') {
                return res.status(200).json(getStatistics());
            }
            return res.status(200).json({ 
                success: true, 
                message: 'API is working! Use POST from Android app.',
                stats: getStatistics()
            });
        }

        // Handle POST request (from Android app)
        if (req.method === 'POST') {
            const { action, data, sms_data, service, amount, txid } = req.body || req.query || {};
            
            console.log('📦 Request:', { action, data, sms_data, service, amount, txid });

            // Save transaction
            if (action === 'save_transaction') {
                if (!data) {
                    return res.status(400).json({ success: false, error: 'No data provided' });
                }
                
                try {
                    const transactionData = typeof data === 'string' ? JSON.parse(data) : data;
                    const saved = saveTransaction(transactionData);
                    return res.status(200).json({
                        success: true,
                        message: 'Transaction saved',
                        transaction: saved
                    });
                } catch (e) {
                    return res.status(400).json({ success: false, error: 'Invalid JSON' });
                }
            }
            
            // Save backup SMS
            if (action === 'save_backup') {
                if (!sms_data) {
                    return res.status(400).json({ success: false, error: 'No SMS data' });
                }
                saveBackupSMS(sms_data);
                return res.status(200).json({ success: true, message: 'Backup saved' });
            }
            
            // Get stats
            if (action === 'get_stats') {
                return res.status(200).json(getStatistics());
            }
            
            // Verify payment
            if (action === 'verify_payment') {
                if (!service || !amount || !txid) {
                    return res.status(400).json({ success: false, error: 'Missing parameters' });
                }
                const result = verifyTransaction(service, amount, txid);
                return res.status(200).json(result);
            }
            
            // Verify without txid
            if (action === 'verify_payment_without_txid') {
                if (!service || !amount) {
                    return res.status(400).json({ success: false, error: 'Missing parameters' });
                }
                const result = verifyTransactionWithoutTxid(service, amount);
                return res.status(200).json(result);
            }
            
            // Clear database
            if (action === 'clear_database') {
                clearDatabase();
                return res.status(200).json({ success: true, message: 'Database cleared' });
            }
            
            return res.status(400).json({ success: false, error: 'Unknown action' });
        }

        return res.status(405).json({ success: false, error: 'Method not allowed' });
        
    } catch (error) {
        console.error('❌ Error:', error);
        return res.status(500).json({ 
            success: false, 
            error: error.message || 'Internal server error'
        });
    }
}

// ==================== DATABASE FUNCTIONS ====================

function saveTransaction(data) {
    const transaction = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        sender: data.sender || '',
        amount: data.amount || '',
        transaction_id: data.transaction_id || '',
        account_number: data.account_number || '',
        reference: data.reference || '',
        service_type: data.service_type || 'Other',
        transaction_type: data.transaction_type || 'Unknown',
        timestamp: new Date().toISOString(),
        sim_info: data.sim_info || '',
        original_message: data.original_message || '',
        status: 'PENDING',
        verified_at: null,
        verified_by: null
    };
    
    memoryDB.transactions.unshift(transaction);
    updateStats();
    return transaction;
}

function saveBackupSMS(smsData) {
    memoryDB.backup_sms.unshift({
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        sms_data: smsData,
        timestamp: new Date().toISOString()
    });
    if (memoryDB.backup_sms.length > 100) memoryDB.backup_sms.pop();
}

function verifyTransaction(service, amount, txid) {
    const cleanAmount = parseFloat(amount.toString().replace(/[^0-9.]/g, '')).toString();
    
    const transaction = memoryDB.transactions.find(t => 
        t.status === 'PENDING' &&
        t.service_type?.toLowerCase() === service.toLowerCase() &&
        t.transaction_id === txid &&
        parseFloat(t.amount?.toString().replace(/[^0-9.]/g, '') || '0').toString() === cleanAmount
    );
    
    if (transaction) {
        transaction.status = 'COMPLETED';
        transaction.verified_at = new Date().toISOString();
        transaction.verified_by = 'API';
        updateStats();
        return {
            success: true,
            matched_records: 1,
            message: 'Transaction verified and marked as COMPLETED',
            status: 'COMPLETED'
        };
    }
    
    const existing = memoryDB.transactions.find(t => 
        t.service_type?.toLowerCase() === service.toLowerCase() &&
        t.transaction_id === txid
    );
    
    if (existing) {
        return {
            success: false,
            error: 'TRANSACTION_NOT_PENDING',
            message: 'Transaction found but not in PENDING state',
            status: existing.status
        };
    }
    
    return {
        success: false,
        error: 'NO_MATCH',
        message: 'No matching PENDING transaction found'
    };
}

function verifyTransactionWithoutTxid(service, amount) {
    const cleanAmount = parseFloat(amount.toString().replace(/[^0-9.]/g, '')).toString();
    
    const transaction = memoryDB.transactions.find(t => 
        t.status === 'PENDING' &&
        t.service_type?.toLowerCase() === service.toLowerCase() &&
        parseFloat(t.amount?.toString().replace(/[^0-9.]/g, '') || '0').toString() === cleanAmount
    );
    
    if (transaction) {
        transaction.status = 'COMPLETED';
        transaction.verified_at = new Date().toISOString();
        transaction.verified_by = 'API';
        updateStats();
        return {
            success: true,
            matched_records: 1,
            transaction_id: transaction.transaction_id,
            message: 'Transaction verified and marked as COMPLETED',
            status: 'COMPLETED'
        };
    }
    
    return {
        success: false,
        error: 'NO_MATCH',
        message: 'No matching PENDING transaction found'
    };
}

function getStatistics() {
    updateStats();
    
    const serviceDistArray = Object.entries(memoryDB.stats.service_distribution)
        .map(([service_type, count]) => ({ service_type, count }))
        .sort((a, b) => b.count - a.count);
    
    return {
        total_transactions: memoryDB.stats.total_transactions,
        today_transactions: memoryDB.stats.today_transactions,
        total_amount: memoryDB.stats.total_amount,
        service_distribution: serviceDistArray,
        recent_transactions: memoryDB.transactions.slice(0, 50),
        pending_transactions: memoryDB.stats.pending_transactions,
        completed_transactions: memoryDB.stats.completed_transactions
    };
}

function updateStats() {
    const today = new Date().toDateString();
    let totalAmount = 0;
    let pendingCount = 0;
    let completedCount = 0;
    let todayCount = 0;
    let serviceDist = {};
    
    memoryDB.transactions.forEach(t => {
        if (t.status === 'PENDING') pendingCount++;
        else if (t.status === 'COMPLETED') completedCount++;
        
        if (new Date(t.timestamp).toDateString() === today) {
            todayCount++;
        }
        
        if (t.status === 'COMPLETED' && t.amount) {
            const amt = parseFloat(t.amount.toString().replace(/[^0-9.]/g, ''));
            if (!isNaN(amt)) totalAmount += amt;
        }
        
        if (t.status === 'COMPLETED' && t.service_type) {
            serviceDist[t.service_type] = (serviceDist[t.service_type] || 0) + 1;
        }
    });
    
    memoryDB.stats = {
        total_transactions: memoryDB.transactions.length,
        today_transactions: todayCount,
        total_amount: totalAmount.toFixed(2),
        pending_transactions: pendingCount,
        completed_transactions: completedCount,
        service_distribution: serviceDist
    };
}

function clearDatabase() {
    memoryDB = {
        transactions: [],
        backup_sms: [],
        stats: {
            total_transactions: 0,
            today_transactions: 0,
            total_amount: '0.00',
            pending_transactions: 0,
            completed_transactions: 0,
            service_distribution: {}
        }
    };
}
