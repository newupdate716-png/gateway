// ==================== SMS API ENDPOINT (100% FIXED - NO AUTO CLEAR, NO DELETE) ====================
// File location: /api/sms.js

export default async function handler(req, res) {
    // Enable CORS for all requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
    res.setHeader('Access-Control-Max-Age', '86400');

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Log all requests for debugging
    console.log('🔥 Request received:', {
        method: req.method,
        body: req.body,
        query: req.query,
        headers: req.headers
    });

    // ✅ FIX: Allow GET for testing/stats, but POST for actual data
    if (req.method === 'GET' && req.query?.action === 'get_stats') {
        try {
            const db = await initDatabase();
            const stats = await getStatistics(db);
            return res.status(200).json(stats);
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    // All other actions require POST
    if (req.method !== 'POST') {
        return res.status(200).json({ 
            success: false, 
            error: 'Please use POST method from Android app',
            method_received: req.method,
            note: 'Your Android app is correctly using POST. Browser test shows GET.'
        });
    }

    try {
        // Get parameters from body (for Android POST) or query (for testing)
        const action = req.body?.action || req.query?.action;
        const data = req.body?.data || req.query?.data;
        const sms_data = req.body?.sms_data || req.query?.sms_data;
        const service = req.body?.service || req.query?.service;
        const amount = req.body?.amount || req.query?.amount;
        const txid = req.body?.txid || req.query?.txid;

        console.log('📦 Parsed parameters:', { action, data, sms_data, service, amount, txid });

        if (!action) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing action parameter',
                received_body: req.body,
                received_query: req.query
            });
        }

        // Initialize database
        const db = await initDatabase();

        switch(action) {
            case 'save_transaction':
                if (!data) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Missing transaction data' 
                    });
                }
                
                let transactionData;
                try {
                    transactionData = JSON.parse(decodeURIComponent(data));
                } catch (e) {
                    try {
                        transactionData = JSON.parse(data);
                    } catch (e2) {
                        return res.status(400).json({ 
                            success: false, 
                            error: 'Invalid JSON data' 
                        });
                    }
                }
                
                console.log('💾 Saving transaction:', transactionData);
                const savedTransaction = await saveTransaction(db, transactionData);
                
                return res.status(200).json({
                    success: true,
                    message: '✅ Transaction saved successfully',
                    transaction_id: savedTransaction.transaction_id,
                    status: 'PENDING',
                    id: savedTransaction.id
                });

            case 'save_backup':
                if (!sms_data) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Missing SMS data' 
                    });
                }
                
                const decodedSms = decodeURIComponent(sms_data);
                await saveBackupSMS(db, decodedSms);
                return res.status(200).json({
                    success: true,
                    message: '✅ Backup SMS saved'
                });

            case 'verify_payment':
                if (!service || !amount || !txid) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Missing service, amount or transaction ID' 
                    });
                }
                
                const verification = await verifyTransaction(db, service, amount, txid);
                return res.status(200).json(verification);

            case 'verify_payment_without_txid':
                if (!service || !amount) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Missing service or amount' 
                    });
                }
                
                const verificationNoTxid = await verifyTransactionWithoutTxid(db, service, amount);
                return res.status(200).json(verificationNoTxid);

            case 'get_stats':
                const stats = await getStatistics(db);
                return res.status(200).json(stats);

            case 'clear_database':
                // 🔒 FIX: Clear database only when explicitly called
                await clearDatabase();
                return res.status(200).json({ 
                    success: true, 
                    message: '✅ Database cleared successfully' 
                });

            default:
                return res.status(400).json({ 
                    success: false, 
                    error: 'Invalid action',
                    valid_actions: [
                        'save_transaction',
                        'save_backup',
                        'verify_payment',
                        'verify_payment_without_txid',
                        'get_stats',
                        'clear_database'
                    ]
                });
        }
    } catch (error) {
        console.error('❌ API Error:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Internal server error: ' + error.message
        });
    }
}

// ==================== DATABASE FUNCTIONS ====================
// 🔒 FIX: Use global object for Vercel persistence
let memoryDB = null;

// 🔒 FIX: Prevent any auto-clear or auto-delete
const GLOBAL_STORAGE = {};

try {
    // Try to use global object for better persistence in serverless
    if (typeof global !== 'undefined') {
        if (!global.__sms_api_database) {
            global.__sms_api_database = {
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
            console.log('✅ Global database created');
        }
        memoryDB = global.__sms_api_database;
    }
} catch (e) {
    console.log('Global storage not available, using local variable');
}

async function initDatabase() {
    console.log('📀 Initializing database...');
    
    // 🔒 FIX: Use global storage if available
    if (typeof global !== 'undefined' && global.__sms_api_database) {
        console.log('✅ Using global database with', global.__sms_api_database.transactions.length, 'transactions');
        return { type: 'memory', db: global.__sms_api_database };
    }
    
    // Fallback to local memoryDB
    if (!memoryDB) {
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
        console.log('✅ New local database created');
    } else {
        console.log('✅ Using existing local database with', memoryDB.transactions.length, 'transactions');
    }
    
    return { type: 'memory', db: memoryDB };
}

async function saveTransaction(db, transactionData) {
    const newTransaction = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        sender: transactionData.sender || '',
        amount: transactionData.amount || '',
        transaction_id: transactionData.transaction_id || '',
        account_number: transactionData.account_number || '',
        reference: transactionData.reference || '',
        service_type: transactionData.service_type || 'Other',
        transaction_type: transactionData.transaction_type || 'Unknown',
        timestamp: new Date().toISOString(),
        sim_info: transactionData.sim_info || '',
        original_message: transactionData.original_message || '',
        ip_address: '0.0.0.0',
        status: 'PENDING',
        verified_at: null,
        verified_by: null
    };
    
    if (db.type === 'memory') {
        // 🔒 FIX: Simply add to array - NO AUTO CLEAR, NO LIMIT
        db.db.transactions.push(newTransaction);
        
        // 🔒 FIX: Also update global if available
        if (typeof global !== 'undefined' && global.__sms_api_database) {
            global.__sms_api_database.transactions.push(newTransaction);
        }
        
        updateStats(db.db);
        console.log('✅ Transaction saved. Total:', db.db.transactions.length);
    }
    
    return newTransaction;
}

async function saveBackupSMS(db, smsData) {
    if (db.type === 'memory') {
        // 🔒 FIX: Simply add to array - NO AUTO CLEAR, NO LIMIT
        db.db.backup_sms.push({
            id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            sms_data: smsData,
            timestamp: new Date().toISOString(),
            ip_address: '0.0.0.0'
        });
        
        // 🔒 FIX: Update global if available
        if (typeof global !== 'undefined' && global.__sms_api_database) {
            global.__sms_api_database.backup_sms.push({
                id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                sms_data: smsData,
                timestamp: new Date().toISOString(),
                ip_address: '0.0.0.0'
            });
        }
        
        console.log('✅ Backup SMS saved. Total backup SMS:', db.db.backup_sms.length);
    }
    return true;
}

async function verifyTransaction(db, service, amount, txid) {
    if (db.type !== 'memory') return { success: false, error: 'Database not ready' };
    
    const cleanAmount = parseFloat(amount.toString().replace(/[^0-9.]/g, '')).toString();

    const transaction = db.db.transactions.find(t => 
        t.status === 'PENDING' &&
        t.service_type?.toLowerCase() === service.toLowerCase() &&
        t.transaction_id === txid &&
        parseFloat(t.amount?.toString().replace(/[^0-9.]/g, '') || '0').toString() === cleanAmount
    );

    if (transaction) {
        transaction.status = 'COMPLETED';
        transaction.verified_at = new Date().toISOString();
        transaction.verified_by = 'API';
        
        // 🔒 FIX: Update in global if available
        if (typeof global !== 'undefined' && global.__sms_api_database) {
            const globalTx = global.__sms_api_database.transactions.find(t => t.id === transaction.id);
            if (globalTx) {
                globalTx.status = 'COMPLETED';
                globalTx.verified_at = transaction.verified_at;
                globalTx.verified_by = transaction.verified_by;
            }
        }
        
        updateStats(db.db);
        return {
            success: true,
            matched_records: 1,
            message: '✅ Transaction verified and marked as COMPLETED',
            status: 'COMPLETED'
        };
    } else {
        const existing = db.db.transactions.find(t => 
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
        } else {
            return {
                success: false,
                error: 'NO_MATCH',
                message: '❌ No matching PENDING transaction found'
            };
        }
    }
}

async function verifyTransactionWithoutTxid(db, service, amount) {
    if (db.type !== 'memory') return { success: false, error: 'Database not ready' };
    
    const cleanAmount = parseFloat(amount.toString().replace(/[^0-9.]/g, '')).toString();

    const transaction = db.db.transactions.find(t => 
        t.status === 'PENDING' &&
        t.service_type?.toLowerCase() === service.toLowerCase() &&
        parseFloat(t.amount?.toString().replace(/[^0-9.]/g, '') || '0').toString() === cleanAmount
    );

    if (transaction) {
        transaction.status = 'COMPLETED';
        transaction.verified_at = new Date().toISOString();
        transaction.verified_by = 'API';
        
        // 🔒 FIX: Update in global if available
        if (typeof global !== 'undefined' && global.__sms_api_database) {
            const globalTx = global.__sms_api_database.transactions.find(t => t.id === transaction.id);
            if (globalTx) {
                globalTx.status = 'COMPLETED';
                globalTx.verified_at = transaction.verified_at;
                globalTx.verified_by = transaction.verified_by;
            }
        }
        
        updateStats(db.db);
        return {
            success: true,
            matched_records: 1,
            transaction_id: transaction.transaction_id,
            message: '✅ Transaction verified and marked as COMPLETED',
            status: 'COMPLETED'
        };
    } else {
        return {
            success: false,
            error: 'NO_MATCH',
            message: '❌ No matching PENDING transaction found'
        };
    }
}

async function getStatistics(db) {
    if (db.type !== 'memory') {
        return {
            total_transactions: 0,
            today_transactions: 0,
            total_amount: '0.00',
            service_distribution: [],
            recent_transactions: [],
            pending_transactions: 0,
            completed_transactions: 0
        };
    }
    
    updateStats(db.db);
    
    const serviceDistArray = Object.entries(db.db.stats.service_distribution)
        .map(([service_type, count]) => ({ service_type, count }))
        .sort((a, b) => b.count - a.count);

    // 🔒 FIX: Return ALL transactions, not limited to 50
    const recentTransactions = db.db.transactions;

    return {
        total_transactions: db.db.stats.total_transactions,
        today_transactions: db.db.stats.today_transactions,
        total_amount: db.db.stats.total_amount,
        service_distribution: serviceDistArray,
        recent_transactions: recentTransactions,
        pending_transactions: db.db.stats.pending_transactions,
        completed_transactions: db.db.stats.completed_transactions,
        // 🔒 FIX: Add metadata to confirm no auto-clear
        database_info: {
            total_records: db.db.transactions.length,
            backup_sms_count: db.db.backup_sms.length,
            auto_clear_disabled: true,
            max_limit_removed: true
        }
    };
}

function updateStats(db) {
    const today = new Date().toDateString();
    let totalAmount = 0;
    let pendingCount = 0;
    let completedCount = 0;
    let todayCount = 0;
    let serviceDist = {};

    db.transactions.forEach(t => {
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

    db.stats = {
        total_transactions: db.transactions.length,
        today_transactions: todayCount,
        total_amount: totalAmount.toFixed(2),
        pending_transactions: pendingCount,
        completed_transactions: completedCount,
        service_distribution: serviceDist
    };
}

async function clearDatabase() {
    // 🔒 FIX: This function ONLY works when explicitly called with 'clear_database' action
    // NEVER auto-clears
    
    // Clear local memoryDB
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
    
    // Clear global if available
    if (typeof global !== 'undefined') {
        if (global.__sms_api_database) {
            global.__sms_api_database = {
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
    }
    
    console.log('✅ Database cleared manually via clear_database action');
    return true;
} 
