const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const format = require("date-fns/format");
const app = express();
app.use(express.json());
module.exports = app;
const { open } = require("sqlite");
const path = require("path");
const sqlite3 = require("sqlite3");

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

//db connection and initialize server
const initalizeDBandServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () => {
      console.log(`server running on http://localhost:3000/`);
    });
  } catch (error) {
    console.log(`DB ERROR: ${error.message}`);
    process.exit(1);
  }
};

initalizeDBandServer();

// authentication Token
const authenticationToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
    // console.log(jwtToken);
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "iassjkalamsecretksslajtoken", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        // console.log(payload);
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  }
};

const convertToArrayLikes = (namesObject) => {
  let namesArray = [];
  for (let obj of namesObject) {
    namesArray.push(obj.likes);
  }
  return { likes: namesArray };
};

const convertToArrayReplies = (namesObject) => {
  let namesArray = [];
  for (let obj of namesObject) {
    namesArray.push(obj);
  }
  return { replies: namesArray };
};

// Register
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const checkUsernameQuery = `SELECT * FROM user WHERE username ='${username}'`;
  const checkUsername = await db.get(checkUsernameQuery);
  if (checkUsername === undefined) {
    const passwordLength = password.length;
    if (passwordLength < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 15);
      const registerQuery = `INSERT INTO user (username,password,name,gender)
        VALUES ('${username}','${hashedPassword}','${name}','${gender}')`;
      await db.run(registerQuery);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//Login
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const checkUsernameQuery = `SELECT * FROM user WHERE username ='${username}'`;
  const dbUser = await db.get(checkUsernameQuery);
  //   console.log(dbUser.user_id);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isCorrectPassword = await bcrypt.compare(password, dbUser.password);
    if (isCorrectPassword) {
      const payload = {
        username: username,
        userId: dbUser.user_id,
      };
      const jwtToken = jwt.sign(payload, "iassjkalamsecretksslajtoken");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// Returns the latest tweets of people whom the user follows. Return 4 tweets at a time
app.get(
  "/user/tweets/feed/",
  authenticationToken,
  async (request, response) => {
    const getTweetsQuery = `SELECT username ,tweet,date_time AS dateTime FROM tweet NATURAL JOIN user ORDER BY tweet_id DESC LIMIT 4`;
    const tweets = await db.all(getTweetsQuery);
    response.send(tweets);
  }
);

//Returns the list of all names of people whom the user follows
app.get("/user/following/", authenticationToken, async (request, response) => {
  const { username } = request;
  const getUserId = `SELECT * FROM user WHERE username ='${username}'`;
  const userdetails = await db.get(getUserId);
  const userId = userdetails.user_id;
  const getFollowersQuery = `SELECT name FROM follower INNER JOIN user ON follower.following_user_id = user.user_id WHERE follower_user_id = '${userId}'`;
  const followers = await db.all(getFollowersQuery);
  response.send(followers);
});

//Returns the list of all names of people who follows the user
app.get("/user/followers/", authenticationToken, async (request, response) => {
  const { username } = request;
  const getUserId = `SELECT * FROM user WHERE username ='${username}'`;
  const userdetails = await db.get(getUserId);
  const userId = userdetails.user_id;
  const getFollowersQuery = `SELECT name FROM follower INNER JOIN user ON follower.follower_user_id = user.user_id WHERE following_user_id = '${userId}'`;
  const followers = await db.all(getFollowersQuery);
  //   console.log(request);
  response.send(followers);
});

//If the user requests a tweet other than the users he is following
app.get("/tweets/:tweetId/", authenticationToken, async (request, response) => {
  try {
    const { tweetId } = request.params;
    const { username } = request;
    const getUserId = `SELECT * FROM user WHERE username ='${username}'`;
    const userdetails = await db.get(getUserId);
    const userId = userdetails.user_id;
    const getTweetQuery = `
    SELECT tweet 
    FROM (follower INNER JOIN user
    ON follower.follower_user_id = user.user_id) AS T 
    INNER JOIN  tweet
    ON T.following_user_id = tweet.user_id 
    WHERE tweet_id = ${tweetId} and (follower_user_id = '${userId}' or tweet.user_id = '${userId}')`;
    const tweet = await db.get(getTweetQuery);
    // console.log(tweet);
    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const tweetLikesRepliesQuery = `
      SELECT T.tweet,COUNT(like_id) AS likes,COUNT(reply_id) AS replies, T.date_time AS dateTime
      FROM (tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id) AS T
      INNER JOIN reply ON T.tweet_id = reply.tweet_id
      WHERE T.tweet_id = ${tweetId}`;
      const tweetLikeReply = await db.get(tweetLikesRepliesQuery);
      response.send(tweetLikeReply);
    }
  } catch (error) {
    console.log(`tweet on other ERROR: ${error.message} `);
  }
});

//If the user requests a tweet of a user he is following, return the list of usernames who liked the tweet
app.get(
  "/tweets/:tweetId/likes/",
  authenticationToken,
  async (request, response) => {
    try {
      const { tweetId } = request.params;
      const { username } = request;
      const getUserId = `SELECT * FROM user WHERE username ='${username}'`;
      const userdetails = await db.get(getUserId);
      const userId = userdetails.user_id;
      const getTweetQuery = `
  SELECT tweet 
  FROM (follower INNER JOIN user
   ON follower.follower_user_id = user.user_id) AS T 
  INNER JOIN  tweet
   ON T.following_user_id = tweet.user_id 
   WHERE tweet_id = ${tweetId} and (follower_user_id = '${userId}' or tweet.user_id = '${userId}')`;
      const tweet = await db.get(getTweetQuery);
      // console.log(tweet);
      if (tweet === undefined) {
        response.status(401);
        response.send("Invalid Request");
      } else {
        const tweetLikesQuery = `
      SELECT DISTINCT(name) AS likes
      FROM like INNER JOIN user ON like.user_id = user.user_id
      WHERE tweet_id = ${tweetId}`;
        const tweetLike = await db.all(tweetLikesQuery);
        const array = convertToArrayLikes(tweetLike);
        // console.log(array);
        response.send(array);
      }
    } catch (error) {
      console.log(`tweet on other ERROR: ${error.message} `);
    }
  }
);

//If the user requests a tweet of a user he is following, return the list of replies.
app.get(
  "/tweets/:tweetId/replies/",
  authenticationToken,
  async (request, response) => {
    try {
      const { tweetId } = request.params;
      const { username } = request;
      const getUserId = `SELECT * FROM user WHERE username ='${username}'`;
      const userdetails = await db.get(getUserId);
      const userId = userdetails.user_id;
      const getTweetQuery = `
  SELECT tweet 
  FROM (follower INNER JOIN user
   ON follower.follower_user_id = user.user_id) AS T 
  INNER JOIN  tweet
   ON T.following_user_id = tweet.user_id 
   WHERE tweet_id = ${tweetId} and (follower_user_id = '${userId}' or tweet.user_id = '${userId}')`;
      const tweet = await db.get(getTweetQuery);
      // console.log(tweet);
      if (tweet === undefined) {
        response.status(401);
        response.send("Invalid Request");
      } else {
        const tweetLikesQuery = `
      SELECT name,reply
      FROM reply INNER JOIN user ON reply.user_id = user.user_id
      WHERE tweet_id = ${tweetId}`;
        const tweetReply = await db.all(tweetLikesQuery);
        const array = convertToArrayReplies(tweetReply);
        // console.log(array);
        response.send(array);
      }
    } catch (error) {
      console.log(`tweet on other ERROR: ${error.message} `);
    }
  }
);

// Returns a list of all tweets of the user
app.get("/user/tweets/", authenticationToken, async (request, response) => {
  try {
    const { tweetId } = request.params;
    const { username } = request;
    const getUserId = `SELECT * FROM user WHERE username ='${username}'`;
    const userdetails = await db.get(getUserId);
    const userId = userdetails.user_id;
    const tweetLikesRepliesQuery = `
      SELECT T.tweet,COUNT(like_id) AS likes,COUNT(reply_id) AS replies, T.date_time AS dateTime
      FROM (tweet LEFT JOIN like ON tweet.tweet_id = like.tweet_id) AS T
      LEFT JOIN reply ON T.tweet_id = reply.tweet_id
      WHERE T.user_id = ${userId}
      GROUP BY T.tweet_id`;
    const tweetLikeReply = await db.all(tweetLikesRepliesQuery);
    response.send(tweetLikeReply);
    // }
  } catch (error) {
    console.log(`tweet on other ERROR: ${error.message} `);
  }
});

// Create a tweet in the tweet table
app.post("/user/tweets", authenticationToken, async (request, response) => {
  try {
    const { tweet } = request.body;
    const { username } = request;
    const getUserId = `SELECT * FROM user WHERE username ='${username}'`;
    const userdetails = await db.get(getUserId);
    const userId = userdetails.user_id;
    const dateTime = format(new Date(), "yyyy-MM-dd hh:mm:ss");
    // console.log(dateTime);
    const createTweetQuery = `INSERT INTO
     tweet (tweet,user_id,date_time) 
     VALUES ('${tweet}',${userId},'${dateTime}');`;
    await db.run(createTweetQuery);
    response.send("Created a Tweet");
  } catch (error) {
    console.log(`Create Tweet ERROR:  ${error.message}`);
  }
});

// If the user requests to delete a tweet of other users
app.delete(
  "/tweets/:tweetId/",
  authenticationToken,
  async (request, response) => {
    try {
      const { tweetId } = request.params;
      const { username } = request;
      const getUserId = `SELECT * FROM user WHERE username ='${username}'`;
      const userdetails = await db.get(getUserId);
      const userId = userdetails.user_id;
      const getTweetUserIdQuery = `SELECT * FROM tweet WHERE tweet_id =${tweetId} and user_id=${userId} `;
      const getTweetUserId = await db.get(getTweetUserIdQuery);
      if (getTweetUserId !== undefined) {
        const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id =${tweetId} and user_id=${userId}`;
        await db.run(deleteTweetQuery);
        response.send("Tweet Removed");
      } else {
        response.status(401);
        response.send("Invalid Request");
      }
    } catch (error) {
      console.log(`Delete Tweet ERROR:  ${error.message}`);
    }
  }
);
