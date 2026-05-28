const mongoose = require("mongoose");

const adSchema = new mongoose.Schema({
  title: String,
  position: String, // header, sidebar, footer
  code: String, // ad script or HTML
  image: String,
  link: String,
  startDate: Date,
  endDate: Date,
  active: {
    type: Boolean,
    default: true,
  },
  clicks: {
    type: Number,
    default: 0,
  },
});

module.exports = mongoose.model("Ad", adSchema);
