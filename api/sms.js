// ==================== SMS API ENDPOINT (LIFETIME STORAGE VERSION) ====================
// File location: /api/sms.js

import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI; // 🔥 Add this in Vercel Environment Variables
let client;
let clientPromise;

if (!global._mongoClientPromise) {
    client = new MongoClient(uri);
    global._mongoClientPromise = client.connect();
}
clientPromise = global._mongoClientPromise;

async function getDB() {
    const client = await clientPromise;
    return client.db("sms_database");
}

export default async function handler(req, res) {

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST' && !(req.method === 'GET' && req.query?.action === 'get_stats')) {
        return res.status(400).json({ success: false, error: 'Invalid request method' });
    }

    try {

        const action = req.body?.action || req.query?.action;
        const data = req.body?.data || req.query?.data;
        const sms_data = req.body?.sms_data || req.query?.sms_data;
        const service = req.body?.service || req.query?.service;
        const amount = req.body?.amount || req.query?.amount;
        const txid = req.body?.txid || req.query?.txid;

        const db = await getDB();
        const transactions = db.collection("transactions");
        const backup_sms = db.collection("backup_sms");

        switch(action) {

            // ================= SAVE TRANSACTION =================
            case 'save_transaction':

                let transactionData = JSON.parse(decodeURIComponent(data));

                const newTransaction = {
                    ...transactionData,
                    timestamp: new Date(),
                    status: "PENDING",
                    verified_at: null,
                    verified_by: null
                };

                await transactions.insertOne(newTransaction);

                return res.json({
                    success: true,
                    message: "✅ Transaction saved successfully",
                    transaction_id: newTransaction.transaction_id,
                    status: "PENDING"
                });

            // ================= VERIFY PAYMENT =================
            case 'verify_payment':

                const cleanAmount = parseFloat(amount.toString().replace(/[^0-9.]/g, ''));

                const transaction = await transactions.findOne({
                    status: "PENDING",
                    service_type: { $regex: new RegExp("^" + service + "$", "i") },
                    transaction_id: txid,
                    amount: { $regex: cleanAmount.toString() }
                });

                if (transaction) {

                    await transactions.updateOne(
                        { _id: transaction._id },
                        {
                            $set: {
                                status: "COMPLETED",
                                verified_at: new Date(),
                                verified_by: "API"
                            }
                        }
                    );

                    return res.json({
                        success: true,
                        matched_records: 1,
                        message: "✅ Transaction verified and marked as COMPLETED",
                        status: "COMPLETED"
                    });
                }

                const existing = await transactions.findOne({
                    service_type: { $regex: new RegExp("^" + service + "$", "i") },
                    transaction_id: txid
                });

                if (existing) {
                    return res.json({
                        success: false,
                        error: "TRANSACTION_NOT_PENDING",
                        status: existing.status
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
