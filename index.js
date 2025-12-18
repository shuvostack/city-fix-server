const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://city-fix-server-amber.vercel.app",
    "https://city-fix-316cb.web.app",
    "https://city-fix-316cb.firebaseapp.com"
  ],
  credentials: true
}));
app.use(express.json());

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.6nbocxd.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});


const database = client.db("cityFixDB");
const usersCollection = database.collection("users");
const issuesCollection = database.collection("issues");
const paymentsCollection = database.collection("payments");


async function dbConnect() {
    try {
        await client.connect();
        console.log("Database Connected successfully");
        // await client.db("admin").command({ ping: 1 });
    } catch (error) {
        console.log(error);
    }
}
dbConnect();

// JWT Generate
app.post("/jwt", async (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: "7d",
  });
  res.send({ token });
});

// Verify Token Middleware
const verifyToken = (req, res, next) => {
  if (!req.headers.authorization) {
    return res.status(401).send({ message: "forbidden access" });
  }
  const token = req.headers.authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
};

// Verify Admin Middleware
const verifyAdmin = async (req, res, next) => {
  const email = req.decoded.email;
  const query = { email: email };
  const user = await usersCollection.findOne(query);
  const isAdmin = user?.role === "admin";
  if (!isAdmin) {
    return res.status(403).send({ message: "forbidden access" });
  }
  next();
};

// Verify Staff Middleware
const verifyStaff = async (req, res, next) => {
  const email = req.decoded.email;
  const query = { email: email };
  const user = await usersCollection.findOne(query);
  const isStaff = user?.role === "staff" || user?.role === "admin";
  if (!isStaff) {
    return res.status(403).send({ message: "forbidden access" });
  }
  next();
};


// Update Profile
app.patch("/users/:email", verifyToken, async (req, res) => {
  const email = req.params.email;
  const { name, photo } = req.body;
  const filter = { email: email };
  const updateDoc = {
    $set: { name: name, photo: photo }
  };
  const result = await usersCollection.updateOne(filter, updateDoc);
  res.send(result);
});


// USER MANAGEMENT APIS

// Save or Update User on Login and Register
app.post("/users", async (req, res) => {
  const user = req.body;
  const query = { email: user.email };
  const existingUser = await usersCollection.findOne(query);
  if (existingUser) {
    return res.send({ message: "user already exists", insertedId: null });
  }
  const result = await usersCollection.insertOne(user);
  res.send(result);
});

// Get All Users
app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
  const result = await usersCollection.find().toArray();
  res.send(result);
});

// Get All Staff
app.get("/users/staff", verifyToken, verifyAdmin, async (req, res) => {
  const query = { role: "staff" };
  const result = await usersCollection.find(query).toArray();
  res.send(result);
});

// Get Single User Info
app.get("/users/:email", verifyToken, async (req, res) => {
  const email = req.params.email;
  const query = { email: email };
  const user = await usersCollection.findOne(query);
  res.send(user);
});

// Get User Role
app.get("/users/:email/role", async (req, res) => {
  const email = req.params.email;
  const query = { email: email };
  const user = await usersCollection.findOne(query);
  res.send({ role: user?.role });
});

// Update User Role and Block Status
app.patch("/users/admin/:id", verifyToken, verifyAdmin, async (req, res) => {
    const id = req.params.id;
    const { role, isBlocked } = req.body;
    const filter = { _id: new ObjectId(id) };

    let updateDoc = { $set: {} };
    if (role) updateDoc.$set.role = role;
    if (typeof isBlocked === "boolean")
      updateDoc.$set.isBlocked = isBlocked;

    const result = await usersCollection.updateOne(filter, updateDoc);
    res.send(result);
  }
);


// ISSUE MANAGEMENT APIS

// Create Issue
app.post("/issues", verifyToken, async (req, res) => {
  const issue = req.body;
  issue.status = "pending";
  issue.priority = "Normal"; 
  issue.upvotes = 0;
  issue.upvotedBy = [];
  issue.date = new Date();
  issue.assignedStaff = null;
  
  issue.timeline = [
    {
      status: "pending",
      text: "Issue reported by citizen",
      user: issue.reporterEmail,
      date: new Date(),
    },
  ];

  const result = await issuesCollection.insertOne(issue);
  res.send(result);
});

// Get All Issues 
app.get("/issues", async (req, res) => {
  const { search, status, category, priority, page = 1, limit = 6 } = req.query;

  let query = {};
  if (search) query.title = { $regex: search, $options: "i" };
  if (status) query.status = status;
  if (category) query.category = category;
  if (priority) query.priority = priority;

  const result = await issuesCollection
    .find(query)
    .sort({ priority: 1, date: -1 }) 
    .limit(parseInt(limit))
    .toArray();

  const total = await issuesCollection.countDocuments(query);
  res.send({ issues: result, total });
});

// Get Single Issue Details
app.get("/issues/:id", verifyToken, async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await issuesCollection.findOne(query);
  res.send(result);
});

// Get Issue Count by Email
app.get("/issues/count/:email", verifyToken, async (req, res) => {
  const email = req.params.email;
  const query = { reporterEmail: email };
  const count = await issuesCollection.countDocuments(query);
  res.send({ count });
});

// Get Issues by User Email 
app.get("/issues/my-issues/:email", verifyToken, async (req, res) => {
  const email = req.params.email;
  const result = await issuesCollection
    .find({ reporterEmail: email })
    .toArray();
  res.send(result);
});

// Get Assigned Issues
app.get("/issues/assigned/:email", verifyToken, verifyStaff, async (req, res) => {
    const email = req.params.email;
    const result = await issuesCollection
      .find({ "assignedStaff.email": email })
      .toArray();
    res.send(result);
  }
);

// Upvote Issue
app.patch('/issues/upvote/:id', verifyToken, async (req, res) => {
    const id = req.params.id;
    const userEmail = req.body.email || req.decoded.email; // Support body or token email
    const filter = { _id: new ObjectId(id) };
    
    const issue = await issuesCollection.findOne(filter);

    if (issue.upvotedBy && issue.upvotedBy.includes(userEmail)) {
        return res.status(400).send({ message: 'You have already upvoted this issue.' });
    }

    const updateDoc = {
        $inc: { upvotes: 1 },
        $push: { upvotedBy: userEmail }
    };

    const result = await issuesCollection.updateOne(filter, updateDoc);
    res.send(result);
});

// Update Issue Content
app.patch('/issues/:id', verifyToken, async (req, res) => {
  const id = req.params.id;
  const item = req.body;
  const filter = { _id: new ObjectId(id) };
  
  const updatedDoc = {
    $set: {
      title: item.title,
      category: item.category,
      location: item.location,
      description: item.description
    }
  };

  const result = await issuesCollection.updateOne(filter, updatedDoc);
  res.send(result);
});

// Boost Issue 
app.patch('/issues/:id/boost', verifyToken, async (req, res) => {
    const id = req.params.id;
    const filter = { _id: new ObjectId(id) };
    
    const updateDoc = {
        $set: { priority: "High" },
        $push: {
            timeline: {
                status: "Boosted",
                text: "Priority boosted to High",
                user: req.decoded.email,
                date: new Date()
            }
        }
    };

    const result = await issuesCollection.updateOne(filter, updateDoc);
    res.send(result);
});

// Assign Staff
app.patch("/issues/assign/:id", verifyToken, verifyAdmin, async (req, res) => {
    const id = req.params.id;
    const { staff } = req.body; 
    const filter = { _id: new ObjectId(id) };

    const updateDoc = {
      $set: { assignedStaff: staff },
      $push: {
        timeline: {
          status: "Assigned",
          text: `Issue assigned to Staff: ${staff.name}`,
          user: req.decoded.email,
          date: new Date(),
        },
      },
    };

    const result = await issuesCollection.updateOne(filter, updateDoc);
    res.send(result);
  }
);

// Change Status
app.patch("/issues/status/:id", verifyToken, verifyStaff, async (req, res) => {
    const id = req.params.id;
    const { status } = req.body; 
    const filter = { _id: new ObjectId(id) };

    const updateDoc = {
      $set: { status: status },
      $push: {
        timeline: {
          status: status,
          text: `Status updated to ${status}`,
          user: req.decoded.email,
          date: new Date(),
        },
      },
    };

    const result = await issuesCollection.updateOne(filter, updateDoc);
    res.send(result);
  }
);

// Delete Issue
app.delete("/issues/:id", verifyToken, async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await issuesCollection.deleteOne(query);
  res.send(result);
});


// PAYMENT & STATS APIS

// Get All Payments
app.get("/payments", verifyToken, verifyAdmin, async (req, res) => {
  const result = await paymentsCollection.find().sort({ date: -1 }).toArray();
  res.send(result);
});

// Get Payments by Specific User Email
app.get("/payments/:email", verifyToken, async (req, res) => {
  const email = req.params.email;
  if (email !== req.decoded.email) {
      return res.status(403).send({ message: "forbidden access" });
  }

  const query = { userEmail: email };
  const result = await paymentsCollection.find(query).sort({ date: -1 }).toArray();
  res.send(result);
});

// Payment Intent
app.post("/create-payment-intent", verifyToken, async (req, res) => {
  try {
    const { price } = req.body;

    if (!price) {
      console.log("Error: Price is missing in request body");
      return res.status(400).send({ error: "Price is required" });
    }

    const amount = parseInt(price * 100);
    console.log("Processing Payment for amount (cents):", amount);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: "bdt",
      payment_method_types: ["card"],
    });

    res.send({
      clientSecret: paymentIntent.client_secret,
    });

  } catch (error) {
    console.error("STRIPE ERROR:", error); 
    res.status(500).send({ error: error.message });
  }
});

// Save Payment
app.post("/payments", verifyToken, async (req, res) => {
  const payment = req.body;
  const result = await paymentsCollection.insertOne(payment);

  if (payment.type === "subscription") {
    await usersCollection.updateOne(
      { email: payment.userEmail },
      { $set: { isVerified: true } }
    );
  }

  if (payment.type === "boost" && payment.issueId) {
    await issuesCollection.updateOne(
      { _id: new ObjectId(payment.issueId) },
      {
        $set: { priority: "High" },
        $push: {
          timeline: {
            status: "Boosted",
            text: "Priority boosted to High via payment",
            user: payment.userEmail,
            date: new Date(),
          },
        },
      }
    );
  }

  res.send(result);
});

// Get Admin Stats
app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
  const users = await usersCollection.estimatedDocumentCount();
  const issues = await issuesCollection.estimatedDocumentCount();
  const payments = await paymentsCollection.find().toArray();
  const revenue = payments.reduce((total, p) => total + p.amount, 0);

  res.send({
    totalUsers: users,
    totalIssues: issues,
    totalRevenue: revenue,
  });
});


app.get("/", (req, res) => {
  res.send("CityFix Server is Running");
});

app.listen(port, () => {
  console.log(`CityFix server running on port: ${port}`);
});

module.exports = app;