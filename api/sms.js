// ==================== API ENDPOINT FOR SMS RECEIVING ====================
// This file handles POST requests from your Android app
// File location: /api/sms.js

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only accept POST requests from Android app
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            error: 'Method not allowed. Please use POST.' 
        });
    }

    try {
        const { action, data, sms_data, service, amount, txid } = req.body;

        // Validate API key or password (optional but recommended)
        // const apiKey = req.headers['x-api-key'];
        // if (apiKey !== 'YOUR_SECRET_KEY') {
        //     return res.status(401).json({ success: false, error: 'Unauthorized' });
        // }

        // Initialize or get database from Vercel KV (if using)
        // For demo, we'll use in-memory storage (Vercel KV recommended for production)
        
        switch(action) {
            case 'save_transaction':
                if (!data) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Missing transaction data' 
                    });
                }
                
                const transactionData = JSON.parse(data);
                const savedTransaction = await saveTransaction(transactionData);
                
                return res.status(200).json({
                    success: true,
                    message: 'Transaction saved successfully',
                    transaction_id: savedTransaction.transaction_id,
                    status: 'PENDING'
                });

            case 'save_backup':
                if (!sms_data) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Missing SMS data' 
                    });
                }
                
                await saveBackupSMS(sms_data);
                return res.status(200).json({
                    success: true,
                    message: 'Backup SMS saved'
                });

            case 'verify_payment':
                if (!service || !amount || !txid) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Missing service, amount or transaction ID' 
                    });
                }
                
                const verification = await verifyTransaction(service, amount, txid);
                return res.status(200).json(verification);

            case 'verify_payment_without_txid':
                if (!service || !amount) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Missing service or amount' 
                    });
                }
                
                const verificationNoTxid = await verifyTransactionWithoutTxid(service, amount);
                return res.status(200).json(verificationNoTxid);

            case 'get_stats':
                const stats = await getStatistics();
                return res.status(200).json(stats);

            default:
                return res.status(400).json({ 
                    success: false, 
                    error: 'Invalid action' 
                });
        }
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Internal server error: ' + error.message 
        });
    }
}

// ==================== DATABASE FUNCTIONS ====================
// For production, use Vercel KV (Redis) or MongoDB
// This is a simple file-based storage for demonstration

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join('/tmp', 'sms_database.json'); // Vercel has writable /tmp directory

function readDatabase() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error reading database:', error);
    }
    
    // Default database structure
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

function writeDatabase(db) {
    try {
        // Update stats before saving
        updateStats(db);
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing database:', error);
        return false;
    }
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

async function saveTransaction(transactionData) {
    const db = readDatabase();
    
    // Check for duplicate
    if (transactionData.transaction_id) {
        const existing = db.transactions.find(t => 
            t.transaction_id === transactionData.transaction_id
        );
        if (existing) {
            return existing;
        }
    }
    
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
        ip_address: transactionData.ip_address || '0.0.0.0',
        status: 'PENDING',
        verified_at: null,
        verified_by: null
    };
    
    db.transactions.unshift(newTransaction);
    writeDatabase(db);
    return newTransaction;
}

async function saveBackupSMS(smsData) {
    const db = readDatabase();
    db.backup_sms.unshift({
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        sms_data: smsData,
        timestamp: new Date().toISOString(),
        ip_address: '0.0.0.0'
    });
    if (db.backup_sms.length > 100) db.backup_sms.pop();
    writeDatabase(db);
    return true;
}

async function verifyTransaction(service, amount, txid) {
    const db = readDatabase();
    const cleanAmount = parseFloat(amount.toString().replace(/[^0-9.]/g, '')).toString();

    const transaction = db.transactions.find(t => 
        t.status === 'PENDING' &&
        t.service_type?.toLowerCase() === service.toLowerCase() &&
        t.transaction_id === txid &&
        parseFloat(t.amount?.toString().replace(/[^0-9.]/g, '') || '0').toString() === cleanAmount
    );

    if (transaction) {
        transaction.status = 'COMPLETED';
        transaction.verified_at = new Date().toISOString();
        transaction.verified_by = 'API';
        writeDatabase(db);
        return {
            success: true,
            matched_records: 1,
            message: 'Transaction verified and marked as COMPLETED',
            status: 'COMPLETED'
        };
    } else {
        const existing = db.transactions.find(t => 
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
                message: 'No matching PENDING transaction found'
            };
        }
    }
}

async function verifyTransactionWithoutTxid(service, amount) {
    const db = readDatabase();
    const cleanAmount = parseFloat(amount.toString().replace(/[^0-9.]/g, '')).toString();

    const transaction = db.transactions.find(t => 
        t.status === 'PENDING' &&
        t.service_type?.toLowerCase() === service.toLowerCase() &&
        parseFloat(t.amount?.toString().replace(/[^0-9.]/g, '') || '0').toString() === cleanAmount
    );

    if (transaction) {
        transaction.status = 'COMPLETED';
        transaction.verified_at = new Date().toISOString();
        transaction.verified_by = 'API';
        writeDatabase(db);
        return {
            success: true,
            matched_records: 1,
            transaction_id: transaction.transaction_id,
            message: 'Transaction verified and marked as COMPLETED',
            status: 'COMPLETED'
        };
    } else {
        return {
            success: false,
            error: 'NO_MATCH',
            message: 'No matching PENDING transaction found'
        };
    }
}

async function getStatistics() {
    const db = readDatabase();
    
    const serviceDistArray = Object.entries(db.stats.service_distribution)
        .map(([service_type, count]) => ({ service_type, count }))
        .sort((a, b) => b.count - a.count);

    const recentTransactions = db.transactions.slice(0, 50);

    return {
        total_transactions: db.stats.total_transactions,
        today_transactions: db.stats.today_transactions,
        total_amount: db.stats.total_amount,
        service_distribution: serviceDistArray,
        recent_transactions: recentTransactions,
        pending_transactions: db.stats.pending_transactions,
        completed_transactions: db.stats.completed_transactions
    };
} 
