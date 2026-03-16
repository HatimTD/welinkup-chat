const mongoose = require('mongoose');
mongoose.connect('mongodb://127.0.0.1:27017/welink').then(async () => {
  const result = await mongoose.connection.db.collection('users').updateOne(
    { email: 'tidilihatim2@gmail.com' },
    { $set: {
      role: 'admin',
      plan: 'premium',
      'subscription.plan': 'premium',
      'subscription.status': 'active',
      'subscription.paymentGateway': 'manual',
      'subscription.startDate': new Date(),
      'subscription.endDate': new Date(Date.now() + 365*24*60*60*1000)
    }}
  );
  console.log('Modified:', result.modifiedCount);
  const user = await mongoose.connection.db.collection('users').findOne({ email: 'tidilihatim2@gmail.com' });
  console.log('Email:', user.email, '| Role:', user.role, '| Plan:', user.plan, '| Sub:', JSON.stringify(user.subscription));
  await mongoose.disconnect();
});
