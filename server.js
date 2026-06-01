require("dotenv").config();
const express = require("express");
const session = require("express-session");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const upload = multer();
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const helmet = require("helmet");
const compression = require("compression");

const Post = require("./models/Post");
const Admin = require("./models/Admin");
const Comment = require("./models/Comment");
const Ad = require("./models/Ad");
const Page = require("./models/Page");
const Setting = require("./models/Setting");

const app = express();
app.set("trust proxy", 1);

function capitalizeWords(str) {
  return str.replace(/\b\w/g, char => char.toUpperCase());
}

function timeAgo(date){
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    let interval = Math.floor(seconds / 31536000);
    if(interval >= 1){
        return interval + (interval === 1 ? " year ago" : " years ago");
    }
    interval = Math.floor(seconds / 2592000);
    if(interval >= 1){
        return interval + (interval === 1 ? " month ago" : " months ago");
    }
    interval = Math.floor(seconds / 86400);
    if(interval >= 1){
        return interval + (interval === 1 ? " day ago" : " days ago");
    }
    interval = Math.floor(seconds / 3600);
    if(interval >= 1){
        return interval + (interval === 1 ? " hour ago" : " hours ago");
    }
    interval = Math.floor(seconds / 60);
    if(interval >= 1){
        return interval + (interval === 1 ? " minute ago" : " minutes ago");
    }
    return seconds + (seconds === 1 ? " second ago" : " seconds ago");
}

app.locals.timeAgo = timeAgo;
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(compression());

// ===== SETTINGS =====
// POSTS upload
const postUploadPath = path.join(__dirname, "public/uploads");

// ADS upload
const adsUploadPath = path.join(__dirname, "public/uploads/ads");

if (!fs.existsSync(postUploadPath)) {
  fs.mkdirSync(postUploadPath, { recursive: true });
}

if (!fs.existsSync(adsUploadPath)) {
  fs.mkdirSync(adsUploadPath, { recursive: true });
}

// ===== MULTER =====
// POSTS
const postStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, postUploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const uploadPost = multer({ storage: postStorage });


// ADS
const adsStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, adsUploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const uploadAd = multer({ storage: adsStorage });

// ===== MIDDLEWARE =====
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");

app.use(
  session({
    secret: process.env.SESSION_SECRET || "mysecretkey",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      maxAge: 1000 * 60 * 60 * 24,
    },
  }),
);

// ===== AUTH =====
function checkAuth(req, res, next) {
  if (req.session.isAdmin) next();
  else res.redirect("/login");
}

// ===== DB =====
mongoose.set("strictQuery", true);
mongoose.set("bufferCommands", false);

startServer();
mongoose.connection.on("connected", () => {
  console.log("✅ Mongoose connected");
});
mongoose.connection.on("error", (err) => {
  console.log("❌ Mongoose error:", err);
});
mongoose.connection.on("disconnected", () => {
  console.log("⚠️ Mongoose disconnected");
})

// ===== SERVER =====
async function startServer() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB Connected");
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.log("❌ MongoDB Error:", err);
  }
}


// ✅ PUT IT HERE (VERY IMPORTANT)
app.use(async (req, res, next) => {
  try {
    const setting = await Setting.findOne();

    res.locals.setting = setting || {
      siteName: "Global Fresh News",
    };

    next();
  } catch (err) {
    console.log("Setting error:", err);

    res.locals.setting = {
      siteName: "Global Fresh News",
    };

    next();
  }
});

// ===== LOGIN =====
app.get("/login", (req, res) => res.render("login"));

app.post("/login", async (req, res) => {
  const admin = await Admin.findOne({ username: req.body.username });
  if (!admin) return res.send("User not found");

  const match = await bcrypt.compare(req.body.password, admin.password);
  if (!match) return res.send("Wrong password");

  req.session.isAdmin = true;
  req.session.adminId = admin._id;
  res.redirect("/admin");
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// ===== CHANGE PASSWORD =====
app.get("/change-password", checkAuth, (req, res) => {
  res.render("change-password");
});

app.post("/change-password", checkAuth, async (req, res) => {
  const admin = await Admin.findById(req.session.adminId);

  const match = await bcrypt.compare(req.body.oldPassword, admin.password);
  if (!match) return res.send("Old password incorrect");

  const hashed = await bcrypt.hash(req.body.newPassword, 10);
  admin.password = hashed;
  await admin.save();

  res.send("Password updated successfully");
});

// ===== FORGOT PASSWORD =====
app.get("/forgot-password", (req, res) => {
  res.render("forgot");
});

app.post("/forgot-password", async (req, res) => {
  try {
    const admin = await Admin.findOne({ email: req.body.email });

    if (!admin) {
      return res.redirect("/forgot-password?error=1");
    }

    const token = crypto.randomBytes(32).toString("hex");

    admin.resetToken = token;
    admin.resetTokenExpire = Date.now() + 3600000; // 1 hour
    await admin.save();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASS,
      },
    });

    const link = `https://globalfreshnews.com/reset-password/${token}`;

    await transporter.sendMail({
      from: '"Global Fresh News" <chikaodiliuwaonu12@gmail.com>',
      to: admin.email,
      subject: "Password Reset",
      html: `
        <h3>Password Reset</h3>
        <p>Click the button below to reset your password:</p>
        <a href="${link}" style="padding:10px 15px;background:#000;color:#fff;text-decoration:none;">
          Reset Password
        </a>
      `,
    });

    res.redirect("/forgot-password?success=1");

  } catch (err) {
    console.log("❌ ERROR:", err);
    res.redirect("/forgot-password?error=1");
  }
});

// ===== UPDATE PASSWORD =====
// ===== RESET PASSWORD =====
app.get("/reset-password/:token", async (req, res) => {
  const admin = await Admin.findOne({
    resetToken: req.params.token,
    resetTokenExpire: { $gt: Date.now() },
  });

  if (!admin) {
    return res.send("Invalid or expired token");
  }

  res.render("reset", { token: req.params.token });
});

app.post("/reset-password/:token", async (req, res) => {
  try {
    const admin = await Admin.findOne({
      resetToken: req.params.token,
      resetTokenExpire: { $gt: Date.now() },
    });

    if (!admin) {
      return res.redirect(`/reset-password/${req.params.token}?error=1`);
    }

    const hashed = await bcrypt.hash(req.body.password, 10);

    admin.password = hashed;
    admin.resetToken = undefined;
    admin.resetTokenExpire = undefined;

    await admin.save();

    res.redirect("/login?reset=success");

  } catch (err) {
    console.log(err);
    res.redirect(`/reset-password/${req.params.token}?error=1`);
  }
});

// ===== ADMIN REGISTER =====
app.get("/admin/register", (req, res) => {
  res.render("admin-register");
});

app.post("/admin/register", async (req, res) => {
  const { username, email, password } = req.body;

  const existing = await Admin.findOne({ email });
  if (existing) return res.send("Email already exists ");

  const hashed = await bcrypt.hash(password, 10);

  await Admin.create({
    username,
    email,
    password: hashed
  });

  res.redirect("/login");
});


// =====CONTACT =====
app.get("/contact", (req, res) => {
  res.render("contact"); // real EJS file
});

app.post("/contact", upload.none(), async (req, res) => {
  try {
    console.log("BODY:", req.body); // debug

    const { name, email, message } = req.body;

    if (!name || !email || !message) {
      return res.send("❌ All fields are required");
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"${name}" <${email}>`,
      to: "chikaodiliuwaonu12@gmail.com",
      subject: "New Contact Message",
      html: `
        <h2>New Message</h2>
        <p><b>Name:</b> ${name}</p>
        <p><b>Email:</b> ${email}</p>
        <p><b>Message:</b><br>${message}</p>
      `,
    });

    res.send("✅ Message sent successfully");
  } catch (err) {
    console.log("ERROR:", err);
    res.send("❌ Error sending message");
  }
});

// ===== ADMIN CREATE PAGE =====
app.get("/admin/create", checkAuth, (req, res) => {
  res.render("create");
});

// ===== ADMIN =====
app.get("/admin", checkAuth, async (req, res) => {
  const query = req.query.q;

  let posts;

  if (query) {
    posts = await Post.find({
      title: { $regex: query, $options: "i" },
    }).sort({ createdAt: -1 }); // ✅ FIXED
  } else {
    posts = await Post.find().sort({ createdAt: -1 }); // ✅ FIXED
  }

  res.render("admin", { posts, query });
});

//MEDIA
app.get("/admin/media", (req, res) => {
  const files = fs.readdirSync("public/uploads");
  res.render("admin/media", { files });
});

app.post("/admin/media/delete/:name", (req, res) => {
  const filePath = "public/uploads/" + req.params.name;

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  res.redirect("/admin/media");
});

// comment
app.get("/admin/comments", async (req, res) => {
  const comments = await Comment.find().populate("post");
  res.render("admin/comments", { comments });
});

// DELETE COMMENT
app.post("/admin/comments/delete/:id", async (req, res) => {
  await Comment.findByIdAndDelete(req.params.id);
  res.redirect("/admin/comments");
});

// Show all ads
app.get("/admin/ads", checkAuth, async (req, res) => {
  res.send("ADS ROUTE REACHED");
})

//===== ADs =====
app.post("/admin/ads/new", uploadAd.single("image"), async (req, res) => {
  const { title, position, startDate, endDate, code, link } = req.body;

  await Ad.create({
    title,
    position,
    code, // still allow HTML ads
    link,
    image: req.file ? req.file.filename : "",
    startDate,
    endDate,
    active: true,
  });

  res.redirect("/admin/ads");
});

app.use(async (req, res, next) => {
  try {
    const now = new Date();
    const ads = await Ad.find({
      active: true,
      $and: [
        {
          $or: [
            { startDate: { $exists: false } },
            { startDate: { $lte: now } },
          ],
        },
        {
          $or: [
            { endDate: { $exists: false } },
            { endDate: { $gte: now } },
          ],
        },
      ],
    });
    const pickRandom = (arr) => {
      if (!arr.length) return [];
      return [arr[Math.floor(Math.random() * arr.length)]];
    };
    res.locals.ads = {
      header: pickRandom(
        ads.filter((a) => a.position === "header")
      ),
      sidebar: pickRandom(
        ads.filter((a) => a.position === "sidebar")
      ),
      footer: pickRandom(
        ads.filter((a) => a.position === "footer")
      ),
      post: pickRandom(
        ads.filter((a) => a.position === "post")
      ),
    };
    next();
  } catch (err) {
    console.log("Ads middleware error:", err);
    res.locals.ads = {
      header: [],
      sidebar: [],
      footer: [],
      post: [],
    };
    next();
  }
});

app.post("/admin/ads/delete/:id", async (req, res) => {
  try {
    await Ad.findByIdAndDelete(req.params.id);
    res.redirect("/admin/ads");
  } catch (err) {
    console.error(err);
    res.redirect("/admin/ads");
  }
});

app.get("/admin/ads/edit/:id", checkAuth, async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    res.render("admin/edit-ad", {
      ad,
      setting: res.locals.setting || null
    });
  } catch (err) {
    console.log(err);
    res.send(err.stack);
  }
});

app.post("/admin/ads/edit/:id", async (req, res) => {
  const { title, position, code } = req.body;

  await Ad.findByIdAndUpdate(req.params.id, {
    title,
    position,
    code,
  });
  res.redirect("/admin/ads");
});

app.post("/admin/ads/toggle/:id", async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.redirect("/admin/ads");
    }
    ad.active = !ad.active;
    await ad.save();
    res.redirect("/admin/ads");
  } catch (err) {
    console.error(err);
    res.redirect("/admin/ads");
  }
});

app.get("/ad-click/:id", async (req, res) => {
  const ad = await Ad.findById(req.params.id);

  if (!ad) return res.redirect("/");

  ad.clicks += 1;
  await ad.save();

  res.redirect(ad.link || "/");
});

app.get("/admin/create", checkAuth, (req, res) => {
  res.render("create");
});

// ===== PAGE ====
app.get("/admin/pages", checkAuth, async (req, res) => {
  const pages = await Page.find();
  res.render("admin/pages", { pages });
});

app.get("/admin/pages/new", checkAuth, (req, res) => {
  res.render("admin/new-page");
});

app.post("/admin/pages/new", checkAuth, async (req, res) => {
  let slug = req.body.slug;

  if (!slug || slug.trim() === "") {
    slug = req.body.title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, "-");
  }

  await Page.create({
    title: req.body.title,
    slug,
    content: req.body.content,
  });

  res.redirect("/admin/pages");
});

app.get("/admin/pages/edit/:id", checkAuth, async (req, res) => {
  const page = await Page.findById(req.params.id);
  res.render("admin/edit-page", { page });
});

app.post("/admin/pages/edit/:id", checkAuth, async (req, res) => {
  await Page.findByIdAndUpdate(req.params.id, {
    title: req.body.title,
    slug: req.body.slug,
    content: req.body.content,
  });

  res.redirect("/admin/pages");
});

app.post("/admin/pages/delete/:id", checkAuth, async (req, res) => {
  await Page.findByIdAndDelete(req.params.id);
  res.redirect("/admin/pages");
});

app.get("/page/:slug", async (req, res) => {
  const page = await Page.findOne({
    slug: req.params.slug.toLowerCase(),
  });

  if (!page) return res.send("Page not found");

  res.render("page", { page });
});

// GET SETTINGS PAGE
app.get("/admin/settings", async (req, res) => {
  try {
    let setting = await Setting.findOne();

    if (!setting) {
      setting = await Setting.create({});
    }

    res.render("admin/settings", { setting });
  } catch (err) {
    console.log(err);
    res.send("Error loading settings");
  }
});

// SAVE SETTINGS
app.post("/admin/settings", uploadPost.single("logo"), async (req, res) => {
  try {
    let setting = await Setting.findOne();

    console.log("FILE:", req.file);
    if (!setting) {
      setting = new Setting();
    }

    // UPDATE VALUES
    setting.siteName = req.body.siteName;
    setting.themeColor = req.body.themeColor;
    setting.footerText = req.body.footerText;
    setting.logoWidth = req.body.logoWidth + "px";
    setting.logoPosition = req.body.logoPosition;

    // SAVE LOGO
    if (req.file) {
      setting.logo = req.file.filename;
    }

    await setting.save();

    console.log("SETTINGS SAVED:", setting);

    res.redirect("/admin/settings");
  } catch (err) {
    console.log("SAVE ERROR:", err);
    res.send("Error saving settings");
  }
});

//==== AUTO EMBED VIDEO ====
function autoEmbed(content) {

  // 🎥 YOUTUBE
  content = content.replace(
    /https?:\/\/(www\.)?youtube\.com\/watch\?v=([^\s]+)/g,
    `<iframe width="100%" height="400"
      src="https://www.youtube.com/embed/$2"
      frameborder="0" allowfullscreen>
    </iframe>`
  );

  // 🎥 YOUTUBE SHORT
  content = content.replace(
    /https?:\/\/youtu\.be\/([^\s]+)/g,
    `<iframe width="100%" height="400"
      src="https://www.youtube.com/embed/$1"
      frameborder="0" allowfullscreen>
    </iframe>`
  );

  // 📸 INSTAGRAM
  content = content.replace(
    /https?:\/\/(www\.)?instagram\.com\/p\/([^\s]+)/g,
    `<blockquote class="instagram-media">
      <a href="$&"></a>
    </blockquote>`
  );

  // 🎵 TIKTOK
  content = content.replace(
    /https?:\/\/(www\.)?tiktok\.com\/[^\s]+/g,
    `<blockquote class="tiktok-embed">
      <a href="$&"></a>
    </blockquote>`
  );

  // 📘 FACEBOOK
  content = content.replace(
    /https?:\/\/(www\.)?facebook\.com\/[^\s]+/g,
    `<iframe src="https://www.facebook.com/plugins/post.php?href=$&"
      width="100%" height="400" style="border:none;overflow:hidden"
      scrolling="no" frameborder="0" allowfullscreen>
    </iframe>`
  );

  return content;
}

// ===== CREATE POST =====
app.post("/create", uploadPost.single("image"), async (req, res) => {
  console.log("POST HIT ✅");
  console.log(req.body);
  let slug = req.body.slug;

  // AUTO GENERATE SLUG
  if (!slug || slug.trim() === "") {
    slug = req.body.title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, "-");
  }

  // ===== CHECK IF POST ALREADY EXISTS =====
  const existingPost = await Post.findOne({ slug });
  if (existingPost) {
    return res.send(`
      <script>
        const replace = confirm(
          "This post already exists. Do you want to edit/replace it?"
        );
        if (replace) {
          window.location.href = "/edit/${existingPost._id}";
        } else {
          window.history.back();
        }
      </script>
    `);
  }

  // ===== LIMIT BREAKING POSTS =====
  if (req.body.isBreaking === "on") {
    const breakingCount = await Post.countDocuments({
      isBreaking: true,
    });

    // if already 5 breaking posts
    if (breakingCount >= 20) {

      // find oldest breaking post
      const oldestBreaking = await Post.findOne({
        isBreaking: true,
      }).sort({ createdAt: 1 });

      // remove breaking status
      if (oldestBreaking) {
        oldestBreaking.isBreaking = false;
        await oldestBreaking.save();
      }
    }
  }

  // ===== CREATE NEW POST =====
  await Post.create({
    title: req.body.title,
    slug,
    content: autoEmbed(req.body.content),
    author: req.body.author,
    category: req.body.category,
    subCategory: req.body.subCategory,
    image: req.file ? req.file.filename : null,
    altText: req.body.altText || req.body.title,
    caption: req.body.caption,
    metaDescription: req.body.metaDescription,
    keywords: req.body.keywords,
    featureType: req.body.featureType || "none",
    isBreaking: req.body.isBreaking === "on",
    sponsored: req.body.sponsored === "on",
    isPinned: req.body.isPinned === "on",
    pinnedUntil: req.body.pinnedUntil ? new Date(req.body.pinnedUntil) : null,
  });
  res.redirect("/admin");
});

app.post("/upload-editor-image", uploadPost.single("upload"), (req, res) => {
  if (!req.file) {
    return res.json({
      uploaded: 0,
      error: { message: "Upload failed" },
    });
  }

  res.json({
    uploaded: 1,
    fileName: req.file.filename,
    url: "/uploads/" + req.file.filename,
  });
});

// ===== SPONSORED POSTS PAGE =====
app.get("/sponsored", async (req, res) => {
  // AUTO REMOVE EXPIRED PINS
  await Post.updateMany(
    {
      isPinned: true,
      pinnedUntil: { $lt: new Date() },
    },
    {
      isPinned: false,
    },
  );
  const sponsoredPosts = await Post.find({
    sponsored: true,
  })
  .sort({
    isPinned: -1,
    createdAt: -1
  });
  res.render("sponsored", {
    sponsoredPosts,
  });
});

// ===== VIEW POST (FINAL FIX) =====
app.get("/post/:slug", async (req, res) => {
  try {
    const slug = req.params.slug.trim().toLowerCase();

    const post = await Post.findOne({ slug });

    if (!post) return res.send("❌ Post not found");

    // 👇 increment views (optional but important for trending)
    post.views = (post.views || 0) + 1;
    await post.save();

    // get extras
    const comments = await Comment.find({ post: post._id });
    const trending = await Post.find().sort({ views: -1 }).limit(10);
    const related = await Post.find({
      category: post.category,
      sponsored: { $ne: true },
      _id: { $ne: post._id },
    })
      .sort({ createdAt: -1 })
      .limit(9);
    
    const sponsoredPosts = await Post.find({
      sponsored: true,
      _id: { $ne: post._id },
    })
      .sort({ createdAt: -1 })
      .limit(6);
    
    const breaking = await Post.find({
      isBreaking: true,
    })
      .sort({ createdAt: -1 })
      .limit(20);
    
    // =========================
    // 🔥 INSERT AD INTO CONTENT
    // =========================
    let content = post.content;

    if (res.locals.ads.post && res.locals.ads.post.length > 0) {
      const ad = res.locals.ads.post[0];

      const adHTML = ad.image
        ? `<div class="post-ad">
             <a href="${ad.link}">
               <img src="/uploads/ads/${ad.image}" />
             </a>
           </div>`
        : `<div class="post-ad">${ad.code}</div>`;

      let parts = content.split("</p>");

      if (parts.length > 2) {
        parts.splice(2, 0, adHTML); // insert after 2nd paragraph
      }

      content = parts.join("</p>");
    }

    // =========================
    // 🔥 SEND MODIFIED CONTENT
    // =========================
    res.render("post", {
      post: { ...post._doc, content },
      breaking,
      comments,
      trending,
      related,
      sponsoredPosts,
    });
  } catch (err) {
    console.log("❌ ERROR:", err);
    res.send("Server error");
  }
});

// ===== EDIT =====
app.get("/edit/:id", checkAuth, async (req, res) => {
  const post = await Post.findById(req.params.id);
  res.render("edit", { post });
});

app.post("/edit/:id", checkAuth, uploadPost.single("image"), async (req, res) => {
  let slug = req.body.slug;

  // AUTO GENERATE SLUG
  if (!slug || slug.trim() === "") {
    slug = req.body.title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, "-")
  }
  const update = {
    title: req.body.title,
    slug,
    content: autoEmbed(req.body.content),
    author: req.body.author,
    category: req.body.category,
    subCategory: req.body.subCategory,
    isBreaking: !!req.body.isBreaking,
    featureType: req.body.featureType,
    altText: req.body.altText || req.body.title,
    caption: req.body.caption,
    metaDescription: req.body.metaDescription,
    keywords: req.body.keywords,
    sponsored: req.body.sponsored === "on",
    isPinned: req.body.isPinned === "on",
    pinnedUntil: req.body.pinnedUntil
      ? new Date(req.body.pinnedUntil)
      : null,
  };
  if (req.file) {
    update.image = req.file.filename;
  }
  await Post.findByIdAndUpdate(req.params.id, update);
  res.redirect("/admin");
});

// ===== DELETE =====
app.get("/delete/:id", checkAuth, async (req, res) => {
  await Post.findByIdAndDelete(req.params.id);
  res.redirect("/admin");
});

// ===== HOME =====
app.get("/", async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 6;

  await Post.updateMany(
    {
      isPinned: true,
      pinnedUntil: { $lt: new Date() },
    },
    {
      isPinned: false,
    },
  );

  // ✅ FETCH DATA
  const postsRaw = await Post.find()
    .sort({ isPinned: -1, createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  const trendingRaw = await Post.find()
    .sort({ isPinned: -1, views: -1, createdAt: -1 })
    .limit(10);

  const breakingRaw = await Post.find({
    isBreaking: true,
  }).sort({
    createdAt: -1,
  })
  .limit(20);

  const bigRaw = await Post.find({
    featureType: "big",
  })
    .sort({ isPinned: -1, createdAt: -1 })
    .limit(10);

  const smallRaw = await Post.find({
    featureType: "small",
  })
    .sort({ isPinned: -1, createdAt: -1 })
    .limit(4);

  // ✅ SPONSORED POSTS
  const sponsoredRaw = await Post.find({
    sponsored: true,
  })
    .sort({ isPinned: -1, createdAt: -1 })
    .limit(6);

  // ✅ FIX SLUGS
  const fix = (arr) =>
    arr.map((p) => ({
      ...p._doc,
      slug: p.slug
        ? p.slug.trim().toLowerCase()
        : "",
    }));

  const posts = fix(postsRaw);
  const trending = fix(trendingRaw);
  const breaking = fix(breakingRaw);
  const bigFeatures = fix(bigRaw);
  const smallFeatures = fix(smallRaw);

  // ✅ FIX SPONSORED
  const sponsoredPosts = fix(sponsoredRaw);

  // ✅ CATEGORY POSTS
  const categories = [
    "Global",
    "Tech",
    "Sports",
    "Entertainment",
    "Politics",
    "Health",
    "Education",
    "Business",
    "Markets",
    "Lifestyle",
  ];

  const categoryPosts = {};
  for (let cat of categories) {
    const data = await Post.find({
      category: cat,
    })
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(6);
    categoryPosts[cat] = fix(data);
  }

  const totalPosts = await Post.countDocuments();

  // ✅ RENDER
  res.render("index", {
    posts,
    trending,
    breaking,
    bigFeatures,
    smallFeatures,
    sponsoredPosts, // ✅ IMPORTANT
    categoryPosts,
    currentPage: page,
    totalPages: Math.ceil(totalPosts / limit),
  });
});

// ===== LIKE =====
app.post("/like/:slug", async (req, res) => {
  const post = await Post.findOneAndUpdate(
    { slug: req.params.slug },
    { $inc: { likes: 1 } },
    { new: true },
  );

  if (!post) return res.send("Post not found");

  res.redirect("/post/" + post.slug);
});

// ===== COMMENT =====
app.post("/comment", async (req, res) => {
  const { name, message, postId } = req.body;

  await Comment.create({
    name,
    message,
    post: new mongoose.Types.ObjectId(postId), // VERY IMPORTANT
  });

  const post = await Post.findById(postId);
  res.redirect("/post/" + post.slug);
});

// ===== SEARCH =====
app.get("/search", async (req, res) => {
  const q = req.query.q;

  const posts = await Post.find({
    $or: [
      { title: { $regex: q, $options: "i" } },
      { content: { $regex: q, $options: "i" } },
    ],
  });

  res.render("search", { posts, query: q });
});

// ===== CATEGORY =====
app.get("/category/:name", async (req, res) => {
  try {
    const raw = req.params.name.trim().toLowerCase();

    const posts = await Post.find({
      category: { $regex: "^" + raw + "$", $options: "i" },
    }).sort({ createdAt: -1 });

    res.render("search", {
      posts,
      query: capitalizeWords(raw), // ✅ FIX HERE
    });
  } catch (err) {
    console.error(err);
    res.send("Error loading category");
  }
});


// ===== SPORTS SUBCATEGORY =====
app.get("/sports/:type", async (req, res) => {
  try {
    const type = req.params.type.trim().toLowerCase();
    const posts = await Post.find({
      subCategory: {
        $regex: "^" + type + "$",
        $options: "i",
      },
    })
      .sort({ createdAt: -1 });
    res.render("search", {
      posts,
      query: capitalizeWords(type),
    });
  } catch (err) {
    console.error(err);
    res.send("Error loading subcategory");
  }
});

// ===== MARKETS PAGE =====
app.get("/markets", async (req, res) => {
  try {
    const marketPosts = await Post.find({
      $or: [
        { category: "Markets" },
        { category: "Business" }
      ]
    })
    .sort({ createdAt: -1 });
    const trendingMarkets = await Post.find({
      $or: [
        { category: "Markets" },
        { category: "Business" }
      ]
    })
    .sort({ views: -1 })
    .limit(6);
    res.render("markets", {
      marketPosts,
      trendingMarkets
    });

  } catch (err) {
    console.log(err);
    res.send("Error loading markets page");
  }
});

// ===== SITEMAP =====
app.get("/sitemap.xml", async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });

    const baseUrl = "https://globalfreshnews.com";

    let urls = posts
      .map(
        (post) => `
      <url>
        <loc>${baseUrl}/post/${post.slug}</loc>
        <lastmod>${new Date(post.updatedAt || post.createdAt).toISOString()}</lastmod>
      </url>`,
      )
      .join("");

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url>
        <loc>${baseUrl}/</loc>
      </url>
      ${urls}
    </urlset>`;

    res.header("Content-Type", "application/xml");
    res.send(sitemap);
  } catch (err) {
    console.log("SITEMAP ERROR:", err);
    res.status(500).send("Error generating sitemap");
  }
});

// ===== STATIC PAGES =====
app.get("/:slug", async (req, res, next) => {
  try {
    const page = await Page.findOne({
      slug: req.params.slug.toLowerCase().trim(),
    });

    if (!page) return next(); // move to next route if not found

    res.render("page", { page });
  } catch (err) {
    console.log(err);
    res.send("Error loading page");
  }
});

app.use((req, res) => {
  res.status(404).render("404");
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send("Server Error");
});

// ===== SERVER =====