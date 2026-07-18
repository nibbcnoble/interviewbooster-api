// db/mongo.js
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI; // e.g. mongodb+srv://user:pass@cluster.mongodb.net/dbname
const dbName = process.env.MONGODB_DB_NAME;

if (!uri) {
  throw new Error('MONGODB_URI is not set in environment variables');
}

let client;
let db;

async function connectToMongo() {
  if (db) return db; // reuse existing connection

  client = new MongoClient(uri, {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
 // family: 4, // force IPv4
});

  try {
    await client.connect();
    db = client.db(dbName);

    await db.collection('stockRecords').createIndex(
      { enc: 1, symbol: 1 },
      { unique: true }
    );
    console.log(`Connected to MongoDB database: ${dbName}`);

    // Optional: verify connection
    await db.command({ ping: 1 });

    return db;
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    throw err;
  }
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call connectToMongo() first.');
  }
  return db;
}

async function closeMongo() {
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
  }
}

module.exports = { connectToMongo, getDb, closeMongo };