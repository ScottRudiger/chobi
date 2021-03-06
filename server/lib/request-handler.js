const User = require('../db/models/user.js');
const multer = require('multer');
const cloudinaryApi = require('./cloudinaryApi.js');
const _ = require('underscore');
const path = require('path');
const bcrypt = require('bcrypt-nodejs');
const Promise = require('bluebird');

// Parses multi-part data from form - used to extract image data
const upload = multer().single('photo'); // 'photo' indicates the name attribute on the multpart/form element (they must be the same)
const requestHandler = {};

// Unused - For private multi-user sharing (not yet implemented)
const showAccessibleAlbums = function (currentUsername, albums) {
  // filters by albums the currentUsername has access to (access property in Schema)
  return _.filter(albums, album => {
    return album.access.includes(currentUsername);
  });
};

// Sends User object to frontend - contains all info (albums, etc.)
requestHandler.getUser = function (req, res) {
  // Logged in user:
  const currentUsername = req.session.username;
  // if the user is trying to view a different user's albums, pull from req.body; else pull from session
  const queryUsername = req.body.username || currentUsername;

  if (currentUsername === queryUsername) {
    User.findOne({ username: req.session.username }, { password: 0 }, (error, user) => {
      if (error) {
        res.status(500).send(error);
      } else {
        res.json(user);
      }
    });
  } else {
    User.findOne({ username: queryUsername }, { password: 0, friends: 0, email: 0 }, (error, user) => { // eslint-disable-line
      if (error) {
        res.status(500).send(error);
      } else {
        user.albums = showAccessibleAlbums(currentUsername, user.albums);
        res.json(user);
      }
    });
  }
};


requestHandler.handleUploadPhoto = (req, res) => {
  // function from multer - used to parse multi-part form data
  upload(req, res, err => {
    if (err) {
      // An error occurred when uploading
      res.status(500).send(err);
      return;
    }

    // .uploadPhotoBuffer from Cloudinary - req.file.buffer from multer
    cloudinaryApi.uploadPhotoBuffer(req.file.buffer, result => {
      const photo = {
        description: req.body.description,
        url: result.url, // result returned from Cloudinary API (url of photo)
      };

      const album = {
        name: req.body.albumName,
        photos: [
          photo,
        ],
      };

      // Find the user and add the uploaded photo
      User.findOne(
        { username: req.session.username },
        (error, user) => {
          let allPhotosIndex;
          let foundAlbumIndex;
          if (!error) {
            // find index of All Photos album
            allPhotosIndex = _.findIndex(user.albums, foundAlbum => {
              return foundAlbum.name === 'All Photos';
            });
            // check if 'All Photos' album exists
            if (allPhotosIndex > -1) {
              // add every photo that gets uploaded to the All Photos album
              user.albums[allPhotosIndex].photos.push(photo);
            // else, ('All Photos' album doesn't exist) create it
            } else {
              const allPhotosAlbum = {
                name: 'All Photos',
                photos: [
                  photo,
                ],
              };
              // and add it to user's albums
              user.albums.push(allPhotosAlbum);
            }
            // if the user specified a different album...
            if (req.body.albumName !== 'All Photos') {
              // check if album already exists by finding its index
              foundAlbumIndex = _.findIndex(user.albums, foundAlbum => {
                return foundAlbum.name === req.body.albumName;
              });
              // if album exists...
              if (foundAlbumIndex > -1) {
                // add the uploaded photo to that album
                user.albums[foundAlbumIndex].photos.push(photo);
              // else, add the album to the user's album list
              } else {
                user.albums.push(album);
              }
            }
            // save updated user and send back to client
            user.save((err, savedUser) => { // eslint-disable-line
              res.status(200).json(savedUser);
            });
          } else {
            res.status(500).json(err);
          }
        } // eslint-disable-line
      );
    });
  });
};


// Authentication methods

requestHandler.sendSignup = function (req, res) {
  res.sendFile(path.join(__dirname, '../../public/signup.html'));
};

requestHandler.sendLogin = function (req, res) {
  res.sendFile(path.join(__dirname, '../../public/login.html'));
};


function createUser(user, req, res) {
  const cipher = Promise.promisify(bcrypt.hash);
  if (!user.profilePic) {
    // default avatar if one wasn't provided
    user.profilePic = 'http://www.lovemarks.com/wp-content/uploads/profile-avatars/default-avatar-tech-guy.png';
  }
  // hash newly created user's password
  cipher(user.password, null, null)
    .then(function (hash) {
      user.password = hash;
      User.create(
        user,
        (error, user) => {// eslint-disable-line
          if (error) {
            res.status(500).redirect('/signup');
          } else {
            req.session.regenerate(() => {
              // pull username from request to identify the current user
              req.session.username = req.body.username;
              res.redirect('/');
            });
          }
        } // eslint-disable-line
      );
    });
}

requestHandler.handleSignup = function (req, res) {
  upload(req, res, () => {
    const user = {
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      username: req.body.username,
      password: req.body.password,
      email: req.body.email,
      profilePic: '',
      albums: [],
    };
    // checks if a profilePic was uploaded
    if (req.file && req.file.buffer) {
      // if so, upload it
      cloudinaryApi.uploadPhotoBuffer(req.file.buffer, result => {
        user.profilePic = result.url;
        createUser(user, req, res);
      });
    } else {
      createUser(user, req, res);
    }
  });
};

requestHandler.handleLogin = function (req, res) {
  User.findOne({ username: req.body.username }, (err, user) => {
    if (user) {
      User.comparePassword(req.body.password, user.password, (err, isAuthenticated) => {
        if (isAuthenticated) {
          req.session.regenerate(() => {
            req.session.username = req.body.username;
            res.redirect('/');
          });
        } else {
          res.redirect('/auth/login');
        }
      });
    } else {
      res.redirect('/auth/signup');
    }
  });
};

requestHandler.handleLogout = function (req, res) {
  req.session.destroy(err => {
    if (err) {
      res.status(500);
    } else {
      res.redirect('/auth/login');
    }
  });
};

module.exports = requestHandler;
