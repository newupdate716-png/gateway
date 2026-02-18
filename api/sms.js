// ==================== SMS API ENDPOINT (100% FIXED WITH PERSISTENT STORAGE) ====================
// File location: /api/sms.js

const fs = require('fs');
const path = require('path');

// Persistent storage file path
const DATA_FILE_PATH = path.join(process.cwd(), 'sms_data.json');

// ==================== PERSISTENT STORAGE FUNCTIONS ====================
function loadPersistentData() {
    try {
        if (fs.existsSync(DATA_FILE_PATH)) {
            const data = fs.readFileSync(DATA_FILE_PATH, 'utf8');
            const parsed = JSON.parse(data);
            console.log('📀 Loaded persistent data:', parsed.transactions?.length || 0, 'transactions');
            return parsed;
        }
    } catch (error) {
        console.error('Error loading persistent data:', error);
    }
    
    // Return default structure if file doesn't exist or error
    return {
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

function savePersistentData(data) {
    try {
        // Update stats before saving
        updateStats(data);
        
        // Write to file
        fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
        console.log('💾 Persistent data saved successfully');
        return true;
    } catch (error) {
        console.error('Error saving persistent data:', error);
        return false;
    }
}

// ==================== DATABASE FUNCTIONS ====================
let persistentDB = null;

async function initDatabase() {
    console.log('📀 Initializing persistent database...');
    
    if (!persistentDB) {
        // Load from file on startup
        persistentDB = loadPersistentData();
        console.log('✅ Database initialized with', persistentDB.transactions.length, 'transactions');
    } else {
        console.log('✅ Using existing database with', persistentDB.transactions.length, 'transactions');
    }
    
    return { type: 'persistent', db: persistentDB };
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
    
    if (db.type === 'persistent') {
        // Add to beginning of array
        db.db.transactions.unshift(newTransaction);
        
        // Limit total transactions to prevent unlimited growth (keep last 10000 transactions)
        if (db.db.transactions.length > 10000) {
            db.db.transactions = db.db.transactions.slice(0, 10000);
        }
        
        // Save to persistent storage
        savePersistentData(db.db);
        
        console.log('✅ Transaction saved. Total:', db.db.transactions.length);
    }
    
    return newTransaction;
}

async function saveBackupSMS(db, smsData) {
    if (db.type === 'persistent') {
        db.db.backup_sms.unshift({
            id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            sms_data: smsData,
            timestamp: new Date().toISOString(),
            ip_address: '0.0.0.0'
        });
        
        // Keep only last 100 backup SMS
        if (db.db.backup_sms.length > 100) {
            db.db.backup_sms = db.db.backup_sms.slice(0, 100);
        }
        
        // Save to persistent storage
        savePersistentData(db.db);
        
        console.log('✅ Backup SMS saved');
    }
    return true;
}

async function verifyTransaction(db, service, amount, txid) {
    if (db.type !== 'persistent') return { success: false, error: 'Database not ready' };
    
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
        
        // Save changes to persistent storage
        savePersistentData(db.db);
        
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
    if (db.type !== 'persistent') return { success: false, error: 'Database not ready' };
    
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
        
        // Save changes to persistent storage
        savePersistentData(db.db);
        
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
    if (db.type !== 'persistent') {
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

    const recentTransactions = db.db.transactions.slice(0, 50);

    return {
        total_transactions: db.db.stats.total_transactions,
        today_transactions: db.db.stats.today_transactions,
        total_amount: db.db.stats.total_amount,
        service_distribution: serviceDistArray,
        recent_transactions: recentTransactions,
        pending_transactions: db.db.stats.pending_transactions,
        completed_transactions: db.db.stats.completed_transactions
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
    // This function now requires explicit action - won't auto-clear
    persistentDB = {
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
    
    // Save empty state to file
    savePersistentData(persistentDB);
    
    console.log('✅ Database cleared manually');
    return true;
}

// ==================== MAIN API HANDLER ====================
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
                // This now requires explicit action - won't auto-clear
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
