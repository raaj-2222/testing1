// OPTIONAL: generate fictional trips for a classroom demo. Run only locally.
// Seeded student accounts use random unknown passwords: they cannot be used
// to log in; create your own account to view the sample trips.
import 'dotenv/config';
import crypto from 'node:crypto';
import { db, transaction, refreshGroup } from '../server/db.js';
import { optimizedMatch } from '../server/matching.js';

const date=new Date(Date.now()+86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const profiles=['Aarav Patil','Meera Shah','Rohan Kulkarni','Diya Desai','Kabir Joshi','Ananya Rao','Ishaan Mehta','Sara Khan','Nisha Iyer','Yash More','Prisha Nair','Aditya Naik'];
const times=[540,547,549,554,557,568,574,579,588,595,608,620];
const demo=[];
transaction(()=>{
  profiles.forEach((name,i)=>{
    const email=`cabshare-demo-${i+1}@vjti.ac.in`;
    let u=db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (!u) {
      const salt=crypto.randomBytes(16).toString('hex');
      const hash=crypto.randomBytes(64).toString('hex');
      u={id:Number(db.prepare(`INSERT INTO users(name,email,password_salt,password_hash,verified)
        VALUES (?,?,?,?,1)`).run(name,email,salt,hash).lastInsertRowid)};
    }
    demo.push({id:u.id, date, direction:'to_vjti', minutes:times[i]});
  });
  const existing=db.prepare('SELECT COUNT(*) AS n FROM trips WHERE trip_date=? AND direction=? AND user_id IN (SELECT id FROM users WHERE email LIKE ?)').get(date,'to_vjti','cabshare-demo-%').n;
  if(existing) { console.log('Demo trips already exist for',date); return; }
  // Same O(n log n) batch matching described in the Algorithms report.
  for(const group of optimizedMatch(demo)) {
    const gid=Number(db.prepare('INSERT INTO ride_groups(trip_date,direction,anchor_minutes) VALUES (?,?,?)')
      .run(group.date,group.direction,group.anchor).lastInsertRowid);
    for(const userId of group.members) {
      const t=demo.find(x=>x.id===userId);
      db.prepare('INSERT INTO trips(user_id,group_id,trip_date,direction,time_minutes) VALUES (?,?,?,?,?)')
        .run(userId,gid,t.date,t.direction,t.minutes);
    }
    refreshGroup(gid);
  }
});
console.log(`Added fictional sample rides for ${date}. Register your own VJTI email and filter to this date.`);
