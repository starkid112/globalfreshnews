const mongoose = require("mongoose");

const pageSchema = new mongoose.Schema({
  title: String,
  slug: String,
  content: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Page", pageSchema);
