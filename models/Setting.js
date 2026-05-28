const mongoose = require("mongoose");

const settingSchema = new mongoose.Schema({
  siteName: String,
  logo: String,
  logoWidth: String, // e.g. "120px"
  logoPosition: String, // left, center, right
  themeColor: String,
  footerText: String,
});

module.exports = mongoose.model("Setting", settingSchema);
