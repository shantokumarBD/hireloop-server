import { MongoClient } from "mongodb";
import "dotenv/config";

const uri = `mongodb://${process.env.MONGODB_USER}:${process.env.MONGODB_PASS}@ac-znydxya-shard-00-00.9qadqxy.mongodb.net:27017,ac-znydxya-shard-00-01.9qadqxy.mongodb.net:27017,ac-znydxya-shard-00-02.9qadqxy.mongodb.net:27017/?ssl=true&replicaSet=atlas-119fez-shard-0&authSource=admin`;

export const client = new MongoClient(uri);

// Connect to MongoDB
await client.connect();
console.log("Successfully connected to MongoDB!");

export const database = client.db("hireloop");
export const users = database.collection("user");
export const sessions = database.collection("session");
export const jobsCollection = database.collection("jobs");
export const applicationsCollection = database.collection("applications");
export const paymentCollection = database.collection("payments");

// Initialize unique indexes for data integrity
try {
  await applicationsCollection.createIndex(
    { jobId: 1, seekerEmail: 1 },
    { unique: true }
  );
  await paymentCollection.createIndex(
    { sessionId: 1 },
    { unique: true }
  );
  console.log("Unique indexes initialized successfully!");
} catch (err) {
  console.error("Warning: Failed to initialize unique index:", err.message);
}
