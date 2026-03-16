const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
mongoose.connect('mongodb://127.0.0.1:27017/welink').then(async () => {
  const newPassword = 'Godofwar@3';
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  const result = await mongoose.connection.db.collection('users').updateOne(
    { email: 'tidilihatim2@gmail.com' },
    { $set: { password: hashedPassword } }
  );
  console.log('Modified:', result.modifiedCount);

  // Verify it works
  const user = await mongoose.connection.db.collection('users').findOne({ email: 'tidilihatim2@gmail.com' });
  const match = await bcrypt.compare(newPassword, user.password);
  console.log('Password reset verified:', match);

  await mongoose.disconnect();
});
