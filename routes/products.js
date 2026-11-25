const express = require('express');
const db = require('../database/db');

const router = express.Router();

router.get('/', (req, res, next) => {
  try {
    const products = db.prepare(
      `SELECT id, name, category, price, description, image
       FROM products WHERE available = 1
       ORDER BY CASE category WHEN 'pupusa' THEN 0 ELSE 1 END, id`
    ).all();
    res.json(products);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
