const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
mongoose.connect('mongodb://127.0.0.1:27017/welink').then(async () => {
  const user = await mongoose.connection.db.collection('users').findOne(
    { email: 'tidilihatim2@gmail.com' },
    { projection: { email: 1, password: 1 } }
  );
  console.log('Email:', user.email);
  console.log('Password hash:', user.password);
  console.log('Has bcrypt prefix:', user.password?.startsWith('$2'));

  // Test password comparison
  const testPassword = 'Godofwar@3';
  const match = await bcrypt.compare(testPassword, user.password);
  console.log(`Password "${testPassword}" matches:`, match);

  await mongoose.disconnect();
});
