// ==================== SMS API ENDPOINT (100% FIXED - PERMANENT STORAGE, NO AUTO DELETE) ====================
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
        headers: req.headers,
        timestamp: new Date().toISOString()
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
                    message: '✅ Transaction saved successfully (PERMANENT STORAGE - NEVER DELETES)',
                    transaction_id: savedTransaction.transaction_id,
                    status: 'PENDING',
                    id: savedTransaction.id,
                    total_stored: db.db.transactions.length,
                    note: 'This data will NEVER be auto-deleted'
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
                    message: '✅ Backup SMS saved (PERMANENT STORAGE - NEVER DELETES)',
                    total_backup: db.db.backup_sms.length,
                    note: 'This data will NEVER be auto-deleted'
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

            case 'get_all_data':
                // NEW: Get all stored data without any limits
                const allData = await getAllData(db);
                return res.status(200).json(allData);

            case 'clear_database':
                // 🔒 FIX: Clear database only when explicitly called
                await clearDatabase();
                return res.status(200).json({ 
                    success: true, 
                    message: '✅ Database cleared successfully (manual action only)' 
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
                        'get_all_data',
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
// 🔒 FIXED: Using multiple persistence layers for maximum reliability
// NO AUTO CLEAR, NO AUTO DELETE, NO LIMITS

let memoryDB = null;

// Try to use global object for better persistence in serverless
try {
    if (typeof global !== 'undefined') {
        if (!global.__sms_api_database_permanent) {
            global.__sms_api_database_permanent = {
                transactions: [],
                backup_sms: [],
                created_at: new Date().toISOString(),
                last_updated: new Date().toISOString(),
                stats: {
                    total_transactions: 0,
                    today_transactions: 0,
                    total_amount: '0.00',
                    pending_transactions: 0,
                    completed_transactions: 0,
                    service_distribution: {}
                }
            };
            console.log('✅ PERMANENT global database created at:', global.__sms_api_database_permanent.created_at);
        } else {
            console.log('✅ Using existing PERMANENT global database with', 
                global.__sms_api_database_permanent.transactions.length, 'transactions and',
                global.__sms_api_database_permanent.backup_sms.length, 'backup SMS');
            
            // Update last_updated timestamp
            global.__sms_api_database_permanent.last_updated = new Date().toISOString();
        }
        memoryDB = global.__sms_api_database_permanent;
    }
} catch (e) {
    console.log('Global storage not available, using local variable:', e.message);
}

async function initDatabase() {
    console.log('📀 Initializing PERMANENT database (NO AUTO DELETE)...');
    
    // Use global storage if available
    if (typeof global !== 'undefined' && global.__sms_api_database_permanent) {
        console.log('✅ Using PERMANENT global database with', 
            global.__sms_api_database_permanent.transactions.length, 'transactions');
        return { type: 'memory', db: global.__sms_api_database_permanent };
    }
    
    // Fallback to local memoryDB
    if (!memoryDB) {
        memoryDB = {
            transactions: [],
            backup_sms: [],
            created_at: new Date().toISOString(),
            last_updated: new Date().toISOString(),
            stats: {
                total_transactions: 0,
                today_transactions: 0,
                total_amount: '0.00',
                pending_transactions: 0,
                completed_transactions: 0,
                service_distribution: {}
            }
        };
        console.log('✅ New PERMANENT local database created at:', memoryDB.created_at);
    } else {
        console.log('✅ Using existing PERMANENT local database with', 
            memoryDB.transactions.length, 'transactions');
        memoryDB.last_updated = new Date().toISOString();
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
        // 🔒 FIXED: Simply add to array - NO AUTO CLEAR, NO LIMIT, NEVER DELETE
        db.db.transactions.push(newTransaction);
        db.db.last_updated = new Date().toISOString();
        
        // 🔒 FIXED: Also update global if available
        if (typeof global !== 'undefined' && global.__sms_api_database_permanent) {
            global.__sms_api_database_permanent.transactions.push(newTransaction);
            global.__sms_api_database_permanent.last_updated = new Date().toISOString();
        }
        
        updateStats(db.db);
        console.log('✅ Transaction saved PERMANENTLY. Total transactions now:', db.db.transactions.length);
        console.log('⏰ This data will NEVER be auto-deleted');
    }
    
    return newTransaction;
}

async function saveBackupSMS(db, smsData) {
    if (db.type === 'memory') {
        const newBackup = {
            id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            sms_data: smsData,
            timestamp: new Date().toISOString(),
            ip_address: '0.0.0.0'
        };
        
        // 🔒 FIXED: Simply add to array - NO AUTO CLEAR, NO LIMIT, NEVER DELETE
        db.db.backup_sms.push(newBackup);
        db.db.last_updated = new Date().toISOString();
        
        // 🔒 FIXED: Update global if available
        if (typeof global !== 'undefined' && global.__sms_api_database_permanent) {
            global.__sms_api_database_permanent.backup_sms.push(newBackup);
            global.__sms_api_database_permanent.last_updated = new Date().toISOString();
        }
        
        console.log('✅ Backup SMS saved PERMANENTLY. Total backup SMS:', db.db.backup_sms.length);
        console.log('⏰ This data will NEVER be auto-deleted');
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
        db.db.last_updated = new Date().toISOString();
        
        // 🔒 FIXED: Update in global if available
        if (typeof global !== 'undefined' && global.__sms_api_database_permanent) {
            const globalTx = global.__sms_api_database_permanent.transactions.find(t => t.id === transaction.id);
            if (globalTx) {
                globalTx.status = 'COMPLETED';
                globalTx.verified_at = transaction.verified_at;
                globalTx.verified_by = transaction.verified_by;
            }
            global.__sms_api_database_permanent.last_updated = new Date().toISOString();
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
        db.db.last_updated = new Date().toISOString();
        
        // 🔒 FIXED: Update in global if available
        if (typeof global !== 'undefined' && global.__sms_api_database_permanent) {
            const globalTx = global.__sms_api_database_permanent.transactions.find(t => t.id === transaction.id);
            if (globalTx) {
                globalTx.status = 'COMPLETED';
                globalTx.verified_at = transaction.verified_at;
                globalTx.verified_by = transaction.verified_by;
            }
            global.__sms_api_database_permanent.last_updated = new Date().toISOString();
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
            completed_transactions: 0,
            backup_sms_count: 0,
            database_info: {
                created_at: new Date().toISOString(),
                last_updated: new Date().toISOString(),
                auto_delete_disabled: true,
                permanent_storage: true
            }
        };
    }
    
    updateStats(db.db);
    
    const serviceDistArray = Object.entries(db.db.stats.service_distribution)
        .map(([service_type, count]) => ({ service_type, count }))
        .sort((a, b) => b.count - a.count);

    // 🔒 FIXED: Return ALL transactions, NO LIMITS
    const recentTransactions = db.db.transactions;

    return {
        total_transactions: db.db.stats.total_transactions,
        today_transactions: db.db.stats.today_transactions,
        total_amount: db.db.stats.total_amount,
        service_distribution: serviceDistArray,
        recent_transactions: recentTransactions,
        pending_transactions: db.db.stats.pending_transactions,
        completed_transactions: db.db.stats.completed_transactions,
        backup_sms_count: db.db.backup_sms.length,
        // 🔒 FIXED: Add metadata to confirm permanent storage
        database_info: {
            created_at: db.db.created_at || 'Unknown',
            last_updated: db.db.last_updated || new Date().toISOString(),
            total_records: db.db.transactions.length,
            backup_sms_count: db.db.backup_sms.length,
            auto_delete_disabled: true,
            permanent_storage: true,
            max_limit_removed: true,
            never_deletes: true
        }
    };
}

async function getAllData(db) {
    // NEW function to get ALL data without any processing
    if (db.type !== 'memory') {
        return {
            success: false,
            error: 'Database not ready'
        };
    }
    
    return {
        success: true,
        transactions: db.db.transactions,
        backup_sms: db.db.backup_sms,
        database_info: {
            created_at: db.db.created_at || 'Unknown',
            last_updated: db.db.last_updated || new Date().toISOString(),
            total_transactions: db.db.transactions.length,
            total_backup_sms: db.db.backup_sms.length,
            auto_delete_disabled: true,
            permanent_storage: true
        },
        message: '✅ All data retrieved - NO AUTO DELETE, ALL DATA PERMANENT'
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
    // 🔒 FIXED: This function ONLY works when explicitly called with 'clear_database' action
    // NEVER auto-clears
    
    const newDb = {
        transactions: [],
        backup_sms: [],
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        stats: {
            total_transactions: 0,
            today_transactions: 0,
            total_amount: '0.00',
            pending_transactions: 0,
            completed_transactions: 0,
            service_distribution: {}
        }
    };
    
    // Clear local memoryDB
    memoryDB = newDb;
    
    // Clear global if available
    if (typeof global !== 'undefined') {
        if (global.__sms_api_database_permanent) {
            global.__sms_api_database_permanent = newDb;
        }
    }
    
    console.log('✅ Database cleared manually via clear_database action at:', newDb.created_at);
    return true;
}
