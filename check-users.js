const mongoose = require('mongoose');
mongoose.connect('mongodb://127.0.0.1:27017/welink').then(async () => {
  const users = await mongoose.connection.db.collection('users').find({}, { projection: { email: 1, role: 1, plan: 1 } }).toArray();
  users.forEach(u => console.log(`Email: "${u.email}" | Role: ${u.role} | Plan: ${u.plan}`));
  await mongoose.disconnect();
});
