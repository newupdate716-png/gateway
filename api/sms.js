// ==================== SMS API ENDPOINT (100% WORKING) ====================
// File location: /api/sms.js
// Storage: File-based (using /tmp directory in Vercel)

const fs = require('fs');
const path = require('path');

// Database file path (Vercel's /tmp directory is writable)
const DB_FILE = path.join('/tmp', 'sms_database.json');

// Default database structure
const DEFAULT_DB = {
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

// ==================== HELPER FUNCTIONS ====================

// Read database from file
function readDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading database:', error);
  }
  return JSON.parse(JSON.stringify(DEFAULT_DB)); // Return copy of default
}

// Write database to file
function writeDatabase(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing database:', error);
    return false;
  }
}

// Update statistics
function updateStats(db) {
  const today = new Date().toDateString();
  let totalAmount = 0;
  let pendingCount = 0;
  let completedCount = 0;
  let todayCount = 0;
  let serviceDist = {};

  db.transactions.forEach(t => {
    // Count by status
    if (t.status === 'PENDING') pendingCount++;
    else if (t.status === 'COMPLETED') completedCount++;

    // Today's transactions
    if (new Date(t.timestamp).toDateString() === today) {
      todayCount++;
    }

    // Total amount (completed only)
    if (t.status === 'COMPLETED' && t.amount) {
      const amt = parseFloat(t.amount.toString().replace(/[^0-9.]/g, ''));
      if (!isNaN(amt)) totalAmount += amt;
    }

    // Service distribution (completed only)
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
  
  return db;
}

// ==================== MAIN HANDLER ====================

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  console.log('🔥 Request received:', {
    method: req.method,
    query: req.query,
    body: req.body,
    timestamp: new Date().toISOString()
  });

  try {
    // Handle GET request for stats
    if (req.method === 'GET') {
      const db = readDatabase();
      
      // Format service distribution
      const serviceDistArray = Object.entries(db.stats.service_distribution || {})
        .map(([service_type, count]) => ({ service_type, count }))
        .sort((a, b) => b.count - a.count);

      const recentTransactions = db.transactions.slice(0, 50);

      return res.status(200).json({
        success: true,
        message: 'API is working',
        total_transactions: db.stats.total_transactions || 0,
        today_transactions: db.stats.today_transactions || 0,
        total_amount: db.stats.total_amount || '0.00',
        pending_transactions: db.stats.pending_transactions || 0,
        completed_transactions: db.stats.completed_transactions || 0,
        service_distribution: serviceDistArray,
        recent_transactions: recentTransactions,
        database_size: db.transactions.length,
        tmp_file: DB_FILE
      });
    }

    // Handle POST request
    if (req.method === 'POST') {
      // Get parameters from body
      const { action, data, sms_data, service, amount, txid } = req.body || {};

      console.log('📦 POST Data:', { action, data, sms_data, service, amount, txid });

      if (!action) {
        return res.status(400).json({ 
          success: false, 
          error: 'Missing action parameter' 
        });
      }

      // Read current database
      const db = readDatabase();

      // ========== SAVE TRANSACTION ==========
      if (action === 'save_transaction') {
        if (!data) {
          return res.status(400).json({ 
            success: false, 
            error: 'Missing transaction data' 
          });
        }

        try {
          // Parse transaction data
          let transactionData;
          try {
            transactionData = JSON.parse(decodeURIComponent(data));
          } catch {
            transactionData = JSON.parse(data);
          }

          // Check for duplicate
          if (transactionData.transaction_id) {
            const existing = db.transactions.find(t => 
              t.transaction_id === transactionData.transaction_id
            );
            if (existing) {
              return res.status(200).json({
                success: true,
                message: 'Transaction already exists',
                transaction_id: existing.transaction_id,
                status: existing.status
              });
            }
          }

          // Create new transaction
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
            status: 'PENDING',
            verified_at: null,
            verified_by: null
          };

          // Add to database
          db.transactions.unshift(newTransaction);
          
          // Update stats and save
          updateStats(db);
          writeDatabase(db);

          console.log('✅ Transaction saved:', newTransaction.transaction_id);

          return res.status(200).json({
            success: true,
            message: '✅ Transaction saved successfully',
            transaction_id: newTransaction.transaction_id,
            status: 'PENDING',
            id: newTransaction.id
          });

        } catch (error) {
          console.error('Error saving transaction:', error);
          return res.status(400).json({ 
            success: false, 
            error: 'Invalid transaction data: ' + error.message 
          });
        }
      }

      // ========== SAVE BACKUP ==========
      if (action === 'save_backup') {
        if (!sms_data) {
          return res.status(400).json({ 
            success: false, 
            error: 'Missing SMS data' 
          });
        }

        const decodedSms = decodeURIComponent(sms_data);
        
        db.backup_sms.unshift({
          id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
          sms_data: decodedSms,
          timestamp: new Date().toISOString()
        });

        // Keep only last 100 backups
        if (db.backup_sms.length > 100) db.backup_sms.pop();
        
        writeDatabase(db);

        return res.status(200).json({
          success: true,
          message: '✅ Backup SMS saved'
        });
      }

      // ========== VERIFY PAYMENT ==========
      if (action === 'verify_payment') {
        if (!service || !amount || !txid) {
          return res.status(400).json({ 
            success: false, 
            error: 'Missing service, amount or transaction ID' 
          });
        }

        const cleanAmount = parseFloat(amount.toString().replace(/[^0-9.]/g, '')).toString();

        // Find PENDING transaction
        const transaction = db.transactions.find(t => 
          t.status === 'PENDING' &&
          t.service_type?.toLowerCase() === service.toLowerCase() &&
          t.transaction_id === txid &&
          parseFloat(t.amount?.toString().replace(/[^0-9.]/g, '') || '0').toString() === cleanAmount
        );

        if (transaction) {
          // Update transaction
          transaction.status = 'COMPLETED';
          transaction.verified_at = new Date().toISOString();
          transaction.verified_by = 'API';
          
          // Update stats and save
          updateStats(db);
          writeDatabase(db);

          return res.status(200).json({
            success: true,
            matched_records: 1,
            message: '✅ Transaction verified and marked as COMPLETED',
            status: 'COMPLETED'
          });
        }

        // Check if exists but not PENDING
        const existing = db.transactions.find(t => 
          t.service_type?.toLowerCase() === service.toLowerCase() &&
          t.transaction_id === txid
        );

        if (existing) {
          return res.status(200).json({
            success: false,
            error: 'TRANSACTION_NOT_PENDING',
            message: 'Transaction found but not in PENDING state',
            status: existing.status
          });
        }

        return res.status(200).json({
          success: false,
          error: 'NO_MATCH',
          message: '❌ No matching PENDING transaction found'
        });
      }

      // ========== VERIFY WITHOUT TXID ==========
      if (action === 'verify_payment_without_txid') {
        if (!service || !amount) {
          return res.status(400).json({ 
            success: false, 
            error: 'Missing service or amount' 
          });
        }

        const cleanAmount = parseFloat(amount.toString().replace(/[^0-9.]/g, '')).toString();

        // Find most recent PENDING transaction
        const transaction = db.transactions.find(t => 
          t.status === 'PENDING' &&
          t.service_type?.toLowerCase() === service.toLowerCase() &&
          parseFloat(t.amount?.toString().replace(/[^0-9.]/g, '') || '0').toString() === cleanAmount
        );

        if (transaction) {
          transaction.status = 'COMPLETED';
          transaction.verified_at = new Date().toISOString();
          transaction.verified_by = 'API';
          
          updateStats(db);
          writeDatabase(db);

          return res.status(200).json({
            success: true,
            matched_records: 1,
            transaction_id: transaction.transaction_id,
            message: '✅ Transaction verified and marked as COMPLETED',
            status: 'COMPLETED'
          });
        }

        return res.status(200).json({
          success: false,
          error: 'NO_MATCH',
          message: '❌ No matching PENDING transaction found'
        });
      }

      // ========== GET STATS ==========
      if (action === 'get_stats') {
        updateStats(db);
        
        const serviceDistArray = Object.entries(db.stats.service_distribution || {})
          .map(([service_type, count]) => ({ service_type, count }))
          .sort((a, b) => b.count - a.count);

        const recentTransactions = db.transactions.slice(0, 50);

        return res.status(200).json({
          total_transactions: db.stats.total_transactions || 0,
          today_transactions: db.stats.today_transactions || 0,
          total_amount: db.stats.total_amount || '0.00',
          service_distribution: serviceDistArray,
          recent_transactions: recentTransactions,
          pending_transactions: db.stats.pending_transactions || 0,
          completed_transactions: db.stats.completed_transactions || 0
        });
      }

      // ========== CLEAR DATABASE ==========
      if (action === 'clear_database') {
        writeDatabase(DEFAULT_DB);
        return res.status(200).json({ 
          success: true, 
          message: '✅ Database cleared successfully' 
        });
      }

      // Invalid action
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

    // Method not allowed
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed' 
    });

  } catch (error) {
    console.error('❌ API Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error'
    });
  }
}      case 'save_backup':
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

// ==================== DATABASE FUNCTIONS (PERSISTENT) ====================

// Get database from KV storage
async function getDatabase() {
  try {
    const db = await kv.get('sms_database');
    if (!db) {
      console.log('📀 Creating new database...');
      await kv.set('sms_database', DEFAULT_DB);
      return DEFAULT_DB;
    }
    console.log('✅ Database loaded with', db.transactions?.length || 0, 'transactions');
    return db;
  } catch (error) {
    console.error('❌ Error getting database:', error);
    return DEFAULT_DB;
  }
}

// Save database to KV storage
async function saveDatabase(db) {
  try {
    await kv.set('sms_database', db);
    return true;
  } catch (error) {
    console.error('❌ Error saving database:', error);
    return false;
  }
}

// Save transaction
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
    status: 'PENDING',
    verified_at: null,
    verified_by: null
  };

  db.transactions.unshift(newTransaction);
  updateStats(db);
  await saveDatabase(db);
  
  console.log('✅ Transaction saved. Total:', db.transactions.length);
  return newTransaction;
}

// Save backup SMS
async function saveBackupSMS(db, smsData) {
  db.backup_sms.unshift({
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    sms_data: smsData,
    timestamp: new Date().toISOString()
  });
  
  if (db.backup_sms.length > 100) db.backup_sms.pop();
  await saveDatabase(db);
  console.log('✅ Backup SMS saved');
  return true;
}

// Verify transaction with TXID
async function verifyTransaction(db, service, amount, txid) {
  const cleanAmount = parseFloat(amount.toString().replace(/[^0-9.]/g, '')).toString();

  // Find PENDING transaction
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
    
    updateStats(db);
    await saveDatabase(db);
    
    return {
      success: true,
      matched_records: 1,
      message: '✅ Transaction verified and marked as COMPLETED',
      status: 'COMPLETED'
    };
  }

  // Check if exists but not PENDING
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
  }

  return {
    success: false,
    error: 'NO_MATCH',
    message: '❌ No matching PENDING transaction found'
  };
}

// Verify transaction without TXID
async function verifyTransactionWithoutTxid(db, service, amount) {
  const cleanAmount = parseFloat(amount.toString().replace(/[^0-9.]/g, '')).toString();

  // Find most recent PENDING transaction
  const transaction = db.transactions.find(t =>
    t.status === 'PENDING' &&
    t.service_type?.toLowerCase() === service.toLowerCase() &&
    parseFloat(t.amount?.toString().replace(/[^0-9.]/g, '') || '0').toString() === cleanAmount
  );

  if (transaction) {
    transaction.status = 'COMPLETED';
    transaction.verified_at = new Date().toISOString();
    transaction.verified_by = 'API';
    
    updateStats(db);
    await saveDatabase(db);
    
    return {
      success: true,
      matched_records: 1,
      transaction_id: transaction.transaction_id,
      message: '✅ Transaction verified and marked as COMPLETED',
      status: 'COMPLETED'
    };
  }

  return {
    success: false,
    error: 'NO_MATCH',
    message: '❌ No matching PENDING transaction found'
  };
}

// Get statistics
async function getStatistics(db) {
  updateStats(db);
  
  const serviceDistArray = Object.entries(db.stats.service_distribution || {})
    .map(([service_type, count]) => ({ service_type, count }))
    .sort((a, b) => b.count - a.count);

  const recentTransactions = db.transactions.slice(0, 50);

  return {
    total_transactions: db.stats.total_transactions || 0,
    today_transactions: db.stats.today_transactions || 0,
    total_amount: db.stats.total_amount || '0.00',
    service_distribution: serviceDistArray,
    recent_transactions: recentTransactions,
    pending_transactions: db.stats.pending_transactions || 0,
    completed_transactions: db.stats.completed_transactions || 0
  };
}

// Update statistics
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

// Clear database
async function clearDatabase() {
  await kv.set('sms_database', DEFAULT_DB);
  console.log('✅ Database cleared');
  return true;
}                        status: existing.status
                    });
                }

                return res.json({
                    success: false,
                    error: "NO_MATCH",
                    message: "❌ No matching PENDING transaction found"
                });

            // ================= SAVE BACKUP =================
            case 'save_backup':

                await backup_sms.insertOne({
                    sms_data: decodeURIComponent(sms_data),
                    timestamp: new Date()
                });

                return res.json({ success: true });

            // ================= GET STATS =================
            case 'get_stats':

                const total = await transactions.countDocuments();
                const pending = await transactions.countDocuments({ status: "PENDING" });
                const completed = await transactions.countDocuments({ status: "COMPLETED" });

                return res.json({
                    total_transactions: total,
                    pending_transactions: pending,
                    completed_transactions: completed
                });

            default:
                return res.status(400).json({ success: false, error: "Invalid action" });
        }

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
