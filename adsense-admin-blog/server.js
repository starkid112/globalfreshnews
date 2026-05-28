const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const multer = require("multer");

const Post = require("./models/Post");

const app = express();

// ===== SETTINGS =====
const ADMIN_PASSWORD = "1234"; // change later

// ===== MULTER CONFIG =====
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "public/uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage: storage });

// ===== MIDDLEWARE =====
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");

// ===== DATABASE =====
mongoose.connect("mongodb://127.0.0.1:27017/blogDB");

// ===== ROUTES =====

// 🌍 Home (public)
app.get("/", async (req, res) => {
  const posts = await Post.find().sort({ createdAt: -1 });
  res.render("index", { posts: posts });
});

// 🌍 View single post
app.get("/post/:id", async (req, res) => {
  const post = await Post.findById(req.params.id);
  res.render("post", { post: post });
});

// 🔒 Admin Dashboard
app.get("/admin", async (req, res) => {
  const password = req.query.password;

  if (password === ADMIN_PASSWORD) {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.render("admin", { posts: posts });
  } else {
    res.send("Access Denied ❌");
  }
});

// 🔒 Create page
app.get("/admin/create", (req, res) => {
  const password = req.query.password;

  if (password === ADMIN_PASSWORD) {
    res.render("create");
  } else {
    res.send("Access Denied ❌");
  }
});

// ✅ CREATE POST (WITH IMAGE)
app.post("/create", upload.single("image"), async (req, res) => {
  const newPost = new Post({
    title: req.body.title,
    content: req.body.content,
    image: req.file ? req.file.filename : null,
  });

  await newPost.save();
  res.redirect("/");
});

// 🗑 DELETE (PROTECTED)
app.get("/delete/:id", async (req, res) => {
  const password = req.query.password;

  if (password === ADMIN_PASSWORD) {
    await Post.findByIdAndDelete(req.params.id);
    res.redirect("/admin?password=" + ADMIN_PASSWORD);
  } else {
    res.send("Access Denied ❌");
  }
});

// ✏️ EDIT PAGE (PROTECTED)
app.get("/edit/:id", async (req, res) => {
  const password = req.query.password;

  if (password === ADMIN_PASSWORD) {
    const post = await Post.findById(req.params.id);
    res.render("edit", { post: post });
  } else {
    res.send("Access Denied ❌");
  }
});

// ✏️ UPDATE POST (WITH IMAGE OPTION)
app.post("/edit/:id", upload.single("image"), async (req, res) => {
  const password = req.query.password;

  if (password === ADMIN_PASSWORD) {
    const updateData = {
      title: req.body.title,
      content: req.body.content,
    };

    // If new image uploaded
    if (req.file) {
      updateData.image = req.file.filename;
    }

    await Post.findByIdAndUpdate(req.params.id, updateData);
    res.redirect("/admin?password=" + ADMIN_PASSWORD);
  } else {
    res.send("Access Denied ❌");
  }
});

// 🌍 Static pages
app.get("/about", (req, res) => {
  res.render("about");
});

app.get("/contact", (req, res) => {
  res.render("contact");
});

// ===== START SERVER =====
app.listen(3000, () => {
  console.log("Server running on port 3000");
});
