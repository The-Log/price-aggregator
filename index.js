//06-12-2017, Ankur Mishra & Cameron Mukerjee
var express = require("express");
var app = express();
var http = require("http").Server(app);
var path = require('path');
var cheerio =  require("cheerio");
var request = require("request");
var io = require("socket.io")(http);
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('priceHistory.db');

// gets images from bing
var Scraper = require ('images-scraper')
  , bing = new Scraper.Bing();

app.use("/media",  express.static(path.join(__dirname, '/media')));
app.use("/css",  express.static(path.join(__dirname, '/css')));
app.use("/js", express.static(path.join(__dirname, '/js')));
app.get('/', function(req, res) {
  res.sendFile(__dirname + '/index.html');
});
app.get('/product', function(req, res) {
  res.sendFile(__dirname + '/product.html');
});
app.get('/topSearches', function(req, res) {
  res.sendFile(__dirname + '/topSearches.html');
});

app.listen(app.get('port'), function() {
  console.log("Hosted on http://localhost:" + app.get('port'));
});

var productMap = {};
var freqMap = {};

/*Adds Product and Frequency to freqMap */
db.each("SELECT p, f FROM topSearches", function(err, row) {
    freqMap[row.p] = row.f;
});

var walmart_key = "d9n2yn9pym46wzajadrvdv7k";
var walmart = require('walmart')(walmart_key);
var searchQuery = "iphone";

io.on("connection", function(socket){
  // console.log(socket);
  socket.emit("connection", {freqMap:freqMap,productMap:productMap});
  socket.on("sendQuery", function(data){
    var query = data.query.toLowerCase();
    console.log(query);

    //select * from table where product = iPhone
    var freq = 1;
    /* SQL Database Stuff*/
    db.each("select count(1) from topSearches where p = \""+query+"\"", function(err, row) {
      if (row['count(1)'] == 0){
        console.log("INSERTED");
        var stmt = db.prepare("INSERT INTO topSearches VALUES (?, ?)");
        stmt.run(query, freq);
      }
      db.each("SELECT p, f FROM topSearches", function(err, row) {
          freqMap[row.p] = row.f;
      });
      socket.emit("updateFreq", {freqMap:freqMap});
    });
    db.each("SELECT * FROM topSearches WHERE p=\"" +query + "\"", function(err, row) {
      freq = row.f + 1;
      console.log(freq);
      db.run("UPDATE topSearches SET f = $f WHERE p = $p ", {
        $p:query,
        $f:freq
      });
      db.each("SELECT p, f FROM topSearches", function(err, row) {
          freqMap[row.p] = row.f;
      });
      socket.emit("updateFreq", {freqMap:freqMap});
    })
    /* SQL Database Stuff*/

    productMap = {};
    searchShopping(query, function() {
      /* runs this later, but occurs after emit to client*/
      Object.keys(productMap).forEach(function(key) { /*Purpose is to grab images of product, for ones that don't have them*/
        value = productMap[key];
        imgSrc = value[1]
        if (imgSrc == null) {
          bing.list({
              keyword: key,
              num: 2,
              detail: true,
              async:false
          })
          .then(function (res) {
              if (typeof res[0] != "undefined") {
                imgSrc = res[0].url;
                productMap[key][1] = imgSrc;
              }
              else{
                console.log("ERROR. No response");
                console.log(key);
                imgSrc = "http://thumbs1.picclick.com/d/w1600/pict/262008487540_/Apple-iPhone-5-16GB-Black.jpg";
                productMap[key][1] = imgSrc;
              }
            });
          }
      });
      /*runs this fine*/
      walmart.stores.search(100, query).then(function(data) {
        for (var i = 0; i < data.count; i++) {
          // console.log(data.results[i].name);
          productMap[data.results[i].name] = [(data.results[i].price.priceInCents / 100).toFixed(2).replace(/(\d)(?=(\d{3})+\.)/g, '$1,'), data.results[i].images.largeUrl, "https://www.walmart.com" + data.results[i].walmartCanonicalUrl]
        }
        socket.emit("productMap", {pm:productMap});
      });
    });
  });
  socket.on("track", function(data){
    //product, price, date
    // console.log(data.product +"  -  " + data.price +"  -  " + data.date);
      db.each("select count(1) from productsHistory WHERE PRODUCT = \""+data.product+"\" AND DATE = \"" + data.date +"\"", function(err, row) {
        if (row['count(1)'] == 0){
          console.log("INSERTED");
          var stmt = db.prepare("INSERT INTO productsHistory VALUES (?, ?, ?)");
          stmt.run(data.product, data.price, data.date);
        }
        var productsHistoryMap = {}
        db.each("SELECT PRODUCT, PRICE, DATE FROM productsHistory", function(err, row) {
            if (data.product == row.PRODUCT) {
              console.log(row.PRODUCT +"  -  " + row.PRICE +"  -  " + row.DATE);
              productsHistoryMap[row.DATE] = row.PRICE;
            }
        },
        function(){
          // console.log(productsHistoryMap);
          socket.emit("productsHistory", {productsHistoryMap:productsHistoryMap});
        }
      );
    });
  });
});

/*Searches Shopping.com using cheerio*/
var shoppingURL = "http://www.shopping.com";
function searchShopping(query, callback){
  query = query.split(" ").join("-")
  search = shoppingURL + "/" + query + "/products";
  console.log(search);
  request(search, function(error, response, html){
    var $ = cheerio.load(html);
    // class = .gridBox deal , toSalePrice, dealImage, imgZoomUrl149
    $('.quickLookGridItemFullName.hide').each(function(ix, element) {
      productMap[element.children[0].data] = [];
    });
    var i = 0;
    $('.productPrice').each(function(ix, element) {
      if (typeof element.children[1] != 'undefined') {
        var p = element.children[1].children[0].data.replace(/(\r\n|\n|\r)/gm,"");
        if(!p.startsWith(" ")){
          // console.log(p);
          productMap[Object.keys(productMap)[i]] = [p, null, null]
          i = i + 1;
        }
      }
      else {
        if(typeof element.children.data != 'undefined'){
          var p = element.children.data.replace(/(\r\n|\n|\r)/gm,"");
          productMap[Object.keys(productMap)[i]] = [p, null, null]
          i = i + 1;

        }
        if(typeof element.children[0].data != 'undefined'){
          var p = element.children[0].data.replace(/(\r\n|\n|\r)/gm,"")
          productMap[Object.keys(productMap)[i]] = [p, null, null]
          i = i + 1;
        }
        else{
          console.log(element.children);
        }
      }
    });
    $('.dealImage').each(function(ix, element) {
      var ref = shoppingURL + element.attribs.href;
      for (var i = 0; i < element.children.length; i++) {
        if (typeof element.children[i].attribs != 'undefined' && typeof element.children[i].attribs.title != 'undefined' ) {
          var t = element.children[i].attribs.title;
          var imgSrc = element.children[i].attribs.src;
          t = t.replace(' Cellular Phones','');
          t = t.replace(' Toys','');
          t = t.replace(' on Sale','');
          var temp = productMap[t];
          if (typeof temp != "undefined") {
            if (imgSrc != "http://img.shoppingshadow.com/jfe/bb/common/spacer.gif") {
              temp[1] = imgSrc
            }
            temp[2] = ref
          }
          else {
            console.log([t]);
          }
        }
      }
    });
    $('.productImage').each(function(ix, element) {
      // console.log(element);
      var ref = shoppingURL + element.attribs.href;
      for (var i = 0; i < element.children.length; i++) {
        if (typeof element.children[i].attribs != 'undefined' && typeof element.children[i].attribs.title != 'undefined' ) {
          var t = element.children[i].attribs.title;
          var imgSrc = element.children[i].attribs.src;
          t = t.replace(' Cellular Phones','');
          t = t.replace(' on Sale','');
          t = t.replace(' Toys','');
          var temp = productMap[t];
          if (typeof temp != "undefined") {
            if (imgSrc != "http://img.shoppingshadow.com/jfe/bb/common/spacer.gif") {
              temp[1] = imgSrc
            }
            temp[2] = ref
          }
          else {
            console.log([t]);
          }
        }
      }
    });
    callback();
  });
}
