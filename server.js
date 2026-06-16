require("dotenv").config();
if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET missing");
}
const express = require("express");
const session = require("express-session");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const upload = multer();
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const helmet = require("helmet");
const compression = require("compression");
const sanitizeHtml = require("sanitize-html");
const escape = require("escape-html");
const rateLimit = require("express-rate-limit");
const MongoStore = require("connect-mongo").default;

const Post = require("./models/Post");
const Admin = require("./models/Admin");
const Comment = require("./models/Comment");
const Ad = require("./models/Ad");
const Page = require("./models/Page");
const Setting = require("./models/Setting");

const app = express();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many login attempts. Try again after 15 minutes.",
});

app.use(limiter);
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
    hsts: true
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
  const ext = path.extname(file.originalname);
  cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
}
});

const uploadPost = multer({
  storage: postStorage,

  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];

    cb(null, allowed.includes(file.mimetype));
  },
});


// ADS
const adsStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, adsUploadPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);

    cb(
      null,
      Date.now() + "-" + Math.round(Math.random() * 1e9) + ext,
    );
  }
});

const uploadAd = multer({
  storage: adsStorage,

  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];

    cb(null, allowed.includes(file.mimetype));
  },
});

// ===== MIDDLEWARE =====
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");

app.use(
  session({
    secret: process.env.SESSION_SECRET,

    resave: false,
    saveUninitialized: false,

    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions",
      ttl: 24 * 60 * 60,
    }),

    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24,
      domain: ".globalfreshnews.com",
    },
  }),
);

// ===== COOKIE BANNER ROUTE =====
app.post('/accept-cookies', (req, res) => {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  
  res.cookie('gf_ok', '1', {
    httpOnly: false,           // JS needs to read this
    sameSite: 'Lax',
    secure: isHttps,           // true on https://globalfreshnews.com
    path: '/',
    domain: '.globalfreshnews.com'
    // NO maxAge = dies when browser closes
  });
  res.send('ok');
});

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
});

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

app.post("/login", loginLimiter, async (req, res) => {
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

    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    admin.resetToken = hashedToken;
    admin.resetTokenExpire = Date.now() + 3600000;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASS,
      },
    });

    const link = `https://globalfreshnews.com/reset-password/${token}`;

    await transporter.sendMail({
      from: '"Global Fresh News" <globalfreshnews12@gmail.com>',
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
  const hashedToken = crypto
    .createHash("sha256")
    .update(req.params.token)
    .digest("hex");

  const admin = await Admin.findOne({
    resetToken: hashedToken,
    resetTokenExpire: { $gt: Date.now() },
  });

  if (!admin) {
    return res.send("Invalid or expired token");
  }

  res.render("reset", { token: req.params.token });
});

app.post("/reset-password/:token", async (req, res) => {
  try {
    const hashedToken = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    const admin = await Admin.findOne({
      resetToken: hashedToken,
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
app.get("/admin/register", checkAuth, (req, res) => {
  res.render("admin-register");
});

app.post("/admin/register", checkAuth, async (req, res) => {
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
    console.log("BODY:", req.body);

    const { name, email, message } = req.body;
    if (!name || !email || !message) {
      return res.send("❌ All fields are required");
    }

    const safeName = escape(name);
    const safeEmail = escape(email);
    const safeMessage = escape(message);

    console.log("EMAIL =", process.env.EMAIL);
    console.log("EMAIL_PASS =", process.env.EMAIL_PASS);

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL,

      // ✅ Recipient (THIS WAS MISSING)
      to: process.env.EMAIL,
      replyTo: email,
      subject: `New Contact Message From ${safeName}`,
      html: `
        <h2>New Contact Message</h2>
        <p><strong>Name:</strong> ${safeName}</p>
        <p><strong>Email:</strong> ${safeEmail}</p>
        <p><strong>Message:</strong></p>
        <p>${safeMessage}</p>
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
  
  res.render("admin", {
    posts,
    query
  });
});

app.get("/analytics", checkAuth, async (req, res) => {
  const topPosts = await Post.find()
    .sort({ views: -1 })
    .limit(10);
  const totalPosts = await Post.countDocuments();

  const totalViews = await Post.aggregate([
    {
      $group: {
        _id: null,

        total: { $sum: "$views" },
      },
    },
  ]);

  const totalLikes = await Post.aggregate([
    {
      $group: {
        _id: null,

        total: { $sum: "$likes" },
      },
    },
  ]);

  const topPost = await Post.findOne().sort({ views: -1 });
  const topCategory = await Post.aggregate([
    {
      $group: {
        _id: "$category",

        totalViews: {
          $sum: "$views",
        },
      },
    },
    {
      $sort: {
        totalViews: -1,
      },
    },
    {
      $limit: 1,
    },
  ]);
  
  const latestPosts = await Post.find()
    .sort({ createdAt: -1 })
    .limit(10);

  const topCategories = await Post.aggregate([
    {
      $group: {
        _id: "$category",
        views: { $sum: "$views" },
      },
    },

    {
      $sort: {
        views: -1,
      },
    },

    {
      $limit: 5,
    },
  ]);

  const missingMeta = await Post.countDocuments({
    $or: [{ metaDescription: { $exists: false } }, { metaDescription: "" }],
  });

  const missingImage = await Post.countDocuments({
    $or: [{ image: { $exists: false } }, { image: "" }, { image: null }],
  });

  const missingAlt = await Post.countDocuments({
    $or: [{ altText: { $exists: false } }, { altText: "" }],
  });

  const totalIndexedContent = await Post.countDocuments();

  const sponsoredCount = await Post.countDocuments({
    sponsored: true,
  });

  const breakingCount = await Post.countDocuments({
    isBreaking: true,
  });

  const postsMissingMeta = await Post.find({
    $or: [{ metaDescription: "" }, { metaDescription: null }],
  })
    .select("title slug createdAt")
    .limit(10);

  const postsMissingAlt = await Post.find({
    $or: [{ altText: "" }, { altText: null }],
  })
    .select("title slug createdAt")
    .limit(10);

  const postsMissingImage = await Post.find({
    $or: [{ image: "" }, { image: null }],
  })
    .select("title slug createdAt")
    .limit(10);
  
  const latestPostsWithSEO = await Post.find()
    .sort({ createdAt: -1 })
    .limit(20);
  
  const scoredPosts = latestPostsWithSEO.map((post) => {
    let score = 100;

    if (!post.metaDescription) score -= 20;
    if (!post.image) score -= 20;
    if (!post.altText) score -= 10;
    if (!post.keywords) score -= 10;
    if ((post.title || "").length < 30) score -= 10;
    if ((post.metaDescription || "").length < 100) score -= 10;

    return {
      title: post.title,
      slug: post.slug,
      score,
    };
  });

  res.render("analytics", {
    totalViews: totalViews[0]?.total || 0,
    totalLikes: totalLikes[0]?.total || 0,
    topPost,
    topCategory: topCategory[0]?._id || "None",
    topPosts,
    topCategories,
    totalPosts,
    latestPosts,
    missingMeta,
    missingImage,
    missingAlt,
    totalIndexedContent,
    sponsoredCount,
    breakingCount,
    postsMissingMeta,
    postsMissingAlt,
    postsMissingImage,
    scoredPosts
  });
});

//MEDIA
app.get("/admin/media", checkAuth, (req, res) => {
  const files = fs.readdirSync("public/uploads");
  res.render("admin/media", { files });
});

app.post("/admin/media/delete/:name", checkAuth, (req, res) => {
  const filePath = "public/uploads/" + req.params.name;

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  res.redirect("/admin/media");
});

// comment
app.get("/admin/comments", checkAuth, async (req, res) => {
  const comments = await Comment.find().populate("post");
  res.render("admin/comments", { comments });
});

// DELETE COMMENT
app.post("/admin/comments/delete/:id", checkAuth, async (req, res) => {
  await Comment.findByIdAndDelete(req.params.id);
  res.redirect("/admin/comments");
});

// Show all ads
app.get("/admin/ads", checkAuth, async (req, res) => {
  try {
    const ads = await Ad.find();
    
    res.render("admin/ads", {
      ads,
      setting: res.locals.setting || null
    });
  } catch (err) {
    console.log(err);
    res.send(err.stack);
  }
});

//===== ADs =====
app.get("/admin/ads/new", checkAuth, (req, res) => {
  res.render("admin/new-ad", {
    setting: res.locals.setting || null
  });
});

app.post("/admin/ads/new", checkAuth, uploadAd.single("image"), async (req, res) => {
  const { title, position, startDate, endDate, code, link } = req.body;

const safeCode = sanitizeHtml(req.body.code, {
  allowedTags: false,
  allowedAttributes: false
});
  
  await Ad.create({
    title,
    position,
    code: safeCode, // still allow HTML ads
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
    
    });

    const pickRandom = (arr) => {
      if (!arr.length) return [];
      return [arr[Math.floor(Math.random() * arr.length)]];
    };

    res.locals.ads = {
      header: pickRandom(ads.filter((a) => a.position === "header")),
      sidebar: ads.filter((a) => a.position === "sidebar").slice(0, 5),
      footer: pickRandom(ads.filter((a) => a.position === "footer")),

      homepage: ads.filter((a) => a.position === "homepage"),

      homepageSlot1: ads.filter((a) => a.position === "homepage-slot1"),
      homepageSlot2: ads.filter((a) => a.position === "homepage-slot2"),
      homepageSlot3: ads.filter((a) => a.position === "homepage-slot3"),
      homepageSlot4: ads.filter((a) => a.position === "homepage-slot4"),
      homepageSlot5: ads.filter((a) => a.position === "homepage-slot5"),

      categorySlot1: ads.filter((a) => a.position === "category-slot1"),
      categorySlot2: ads.filter((a) => a.position === "category-slot2"),
      categorySlot3: ads.filter((a) => a.position === "category-slot3"),
      categorySlot4: ads.filter((a) => a.position === "category-slot4"),
      categorySlot5: ads.filter((a) => a.position === "category-slot5"),

      postHeader: pickRandom(ads.filter((a) => a.position === "post-header")),
      postMiddle: pickRandom(ads.filter((a) => a.position === "post-middle")),
      postFooter: pickRandom(ads.filter((a) => a.position === "post-footer")),
    };
    next();
  } catch (err) {
    console.log("Ads middleware error:", err);
    res.locals.ads = {
      header: [],
      homepage: [],

      homepageSlot1: [],
      homepageSlot2: [],
      homepageSlot3: [],
      homepageSlot4: [],
      homepageSlot5: [],

      categorySlot1: [],
      categorySlot2: [],
      categorySlot3: [],
      categorySlot4: [],
      categorySlot5: [],

      sidebar: [],
      "post-header": [],
      "post-middle": [],
      "post-footer": [],
      footer: [],
      post: [],
    };
    next();
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

app.post(
  "/admin/ads/edit/:id", checkAuth, uploadAd.single("image"),

  async (req, res) => {

    const safeCode = sanitizeHtml(req.body.code || "", {
      allowedTags: false,
      allowedAttributes: false
    });

    const {
      title,
      position,
      link,
      startDate,
      endDate,
    } = req.body;

    const update = {
      title,
      position,
      code: safeCode,
      link,
      startDate,
      endDate,
    };

    if (req.file) {
      update.image = req.file.filename;
    }

    await Ad.findByIdAndUpdate(
      req.params.id,
      update,
    );

    res.redirect("/admin/ads");
  },
);

app.post("/admin/ads/toggle/:id", checkAuth, async (req, res) => {
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
app.get("/admin/settings", checkAuth, async (req, res) => {
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
app.post("/admin/settings", checkAuth, uploadPost.single("logo"), async (req, res) => {
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
app.post("/create", checkAuth, uploadPost.single("image"), async (req, res) => {
  console.log("POST HIT ✅");
  console.log(req.body);

  const content = sanitizeHtml(req.body.content, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "iframe",
      "h1",
      "h2",
      "h3",
    ]),
  });

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
    content: autoEmbed(content),
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
    status: req.body.status || "published",
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

    const post = await Post.findOne({
      slug,
      status: "published",
    });

    if (!post) return res.send("❌ Post not found");

    // 👇 increment views (optional but important for trending)
    await Post.updateOne(
      { _id: post._id },
      { $inc: { views: 1 } },
    );

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

   if (res.locals.ads.postHeader && res.locals.ads.postHeader.length) {
     const ad = res.locals.ads.postHeader[0];
     const adHTML = ad.image
       ? `<div class="post-ad">
         <a href="/ad-click/${ad._id}">
           <img src="/uploads/ads/${ad.image}">
         </a>
       </div>`
       : `<div class="post-ad">${ad.code}</div>`;
     content = adHTML + content;
    }

if (res.locals.ads.postMiddle && res.locals.ads.postMiddle.length) {
  const ad = res.locals.ads.postMiddle[0];

  const adHTML = ad.image
    ? `<div class="post-ad">
         <a href="/ad-click/${ad._id}">
           <img src="/uploads/ads/${ad.image}">
         </a>
       </div>`
    : `<div class="post-ad">${ad.code}</div>`;

  let parts = content.split("</p>");

  if (parts.length > 2) {
    parts.splice(2, 0, adHTML);
  }

  if (parts.length > 5) {
    parts.splice(5, 0, adHTML);
  }

  content = parts.join("</p>");
}

    if (res.locals.ads.postFooter && res.locals.ads.postFooter.length) {
      const ad = res.locals.ads.postFooter[0];

      const adHTML = ad.image
        ? `<div class="post-ad">
         <a href="/ad-click/${ad._id}">
           <img src="/uploads/ads/${ad.image}">
         </a>
       </div>`
        : `<div class="post-ad">${ad.code}</div>`;

      content += adHTML;
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
      homepage: res.locals.ads.homepage,
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

  const content = sanitizeHtml(req.body.content, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "iframe",
      "h1",
      "h2",
      "h3",
    ]),
  });

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
    content: autoEmbed(content),
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
    pinnedUntil: req.body.pinnedUntil ? new Date(req.body.pinnedUntil) : null,
    status: req.body.status || "published",
  };
  if (req.file) {
    update.image = req.file.filename;
  }
  await Post.findByIdAndUpdate(req.params.id, update);
  res.redirect("/admin");
});

// ===== DELETE =====
app.post("/delete/:id", checkAuth, async (req, res) => {
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
  const postsRaw = await Post.find({
    status: "published",
  })
    .sort({ isPinned: -1, createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  const trendingRaw = await Post.find({
    status: "published",
  })
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
    status: "published",
  })
    .sort({ isPinned: -1, createdAt: -1 })
    .limit(10);

  const smallRaw = await Post.find({
    featureType: "small",
    status: "published",
  })
    .sort({ isPinned: -1, createdAt: -1 })
    .limit(4);

  // ✅ SPONSORED POSTS
  const sponsoredRaw = await Post.find({
    sponsored: true,
    status: "published",
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
      status: "published",
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
    homepage: res.locals.ads.homepage,
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

  const safeName = escape(name);
  const safeMessage = escape(message);

  await Comment.create({
    name: safeName,
    message: safeMessage,
    post: new mongoose.Types.ObjectId(postId),
  });

  const post = await Post.findById(postId);

  res.redirect("/post/" + post.slug);
});

// ===== SEARCH =====
app.get("/search", async (req, res) => {
  const q = req.query.q || "";

  let posts = [];

  if (q.trim()) {
    posts = await Post.find(
      {
        status: "published",

        $text: { $search: q },
      },
      {
        score: { $meta: "textScore" },
      },
    ).sort({
      score: { $meta: "textScore" },
    });
  }

  res.render("search", {
    posts,
    query: q,
  });
});

// ===== CATEGORY =====
app.get("/category/:name", async (req, res) => {
  try {
    const raw = req.params.name.trim().toLowerCase();

    const posts = await Post.find({
  category: { $regex: "^" + raw + "$", $options: "i" },
  status: "published",
    }).sort({ createdAt: -1 });

    res.render("search", {
      posts,
      query: capitalizeWords(raw), // ✅ FIX HERE
      ads: res.locals.ads
    });
  } catch (err) {
    console.error(err);
    res.send("Error loading category");
  }
});


// ===== SPORTS / SUBCATEGORY =====
app.get("/sports/:type", async (req, res) => {
  try {
    const type = req.params.type.trim().toLowerCase();
    const posts = await Post.find({
      subCategory: {
        $regex: "^" + type + "$",
        $options: "i",
      },
      status: "published",
    }).sort({ createdAt: -1 });
    
    res.render("search", {
      posts,
      query: capitalizeWords(type),
      ads: res.locals.ads
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
      status: "published",
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
    const baseUrl = "https://globalfreshnews.com";

    const posts = await Post.find({
      status: "published",
    }).sort({ createdAt: -1 });
    const pages = await Page.find();

    let urls = "";

    // Homepage
    urls += `
    <url>
      <loc>${baseUrl}/</loc>
      <changefreq>hourly</changefreq>
      <priority>1.0</priority>
    </url>`;

    // Static important pages
    urls += `
    <url>
      <loc>${baseUrl}/contact</loc>
      <changefreq>monthly</changefreq>
      <priority>0.7</priority>
    </url>
    <url>
      <loc>${baseUrl}/markets</loc>
      <changefreq>daily</changefreq>
      <priority>0.8</priority>
    </url>
    <url>
      <loc>${baseUrl}/sponsored</loc>
      <changefreq>daily</changefreq>
      <priority>0.7</priority>
    </url>`;

    // Categories
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
      "Lifestyle"
    ];
    categories.forEach(cat => {
      urls += `
      <url>
        <loc>${baseUrl}/category/${encodeURIComponent(cat)}</loc>
        <changefreq>daily</changefreq>
        <priority>0.8</priority>
      </url>`;
    });

    // Custom Pages
    pages.forEach(page => {
      urls += `
      <url>
        <loc>${baseUrl}/${page.slug}</loc>
        <lastmod>${new Date(
          page.updatedAt || page.createdAt || Date.now()
        ).toISOString()}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.6</priority>
      </url>`;
    });

    // Posts
    posts.forEach(post => {
      urls += `
      <url>
        <loc>${baseUrl}/post/${post.slug}</loc>
        <lastmod>${new Date(
          post.updatedAt || post.createdAt
        ).toISOString()}</lastmod>
        <changefreq>daily</changefreq>
        <priority>0.9</priority>
      </url>`;
    });

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
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