import rateLimit from 'express-rate-limit';
const response={error:{code:'RATE_LIMITED',message:'Too many requests'}};
export const generalLimiter=rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:true,legacyHeaders:false,message:response});
export const authLimiter=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:true,legacyHeaders:false,message:response});
