const mongoose = require("mongoose");

const postSchema = new mongoose.Schema(
  {
    title: String,
    content: String,
    image: String,
    author: String,
    category: String,
    subCategory: String,
    email: String,

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    metaDescription: String,
    keywords: String,
    altText: String,

    views: {
      type: Number,
      default: 0,
    },

    likes: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: ["draft", "published"],
      default: "published",
    },

    featureType: {
      type: String,
      enum: ["big", "small", "none"],
      default: "none",
    },

    isBreaking: {
      type: Boolean,
      default: false,
    },

    isSlider: {
      type: Boolean,
      default: false,
    },

    isExclusiveTop: {
      type: Boolean,
      default: false,
    },

    isExclusiveMiddle: {
      type: Boolean,
      default: false,
    },

    sponsored: {
      type: Boolean,
      default: false,
    },

    isPinned: {
      type: Boolean,
      default: false,
    },

    pinnedUntil: {
      type: Date,
    },

    caption: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }, // 🔥 ADD THIS
);

// postSchema.index({ slug: 1 });

postSchema.index({ category: 1 });

postSchema.index({ subCategory: 1 });

postSchema.index({ createdAt: -1 });

postSchema.index({
  title: "text",
  content: "text",
});

module.exports = mongoose.model("Post", postSchema);
