const express = require('express');

const path = require('path');

const app = express();

let palabras = []; // Array de palabras
let searchedPalabras = []; // Array de palabras buscadas
let datosDePagina = []
let datosDeWebsite = []
let topPalabras = []
let topReferences = []

let pages = []; // Array de paginas
let searchedPages = []; // Array de paginas buscadas

const mariadb = require('mariadb');
const pool = mariadb.createPool({
    user:"root",
    password:"abuelin",
    host:"127.0.0.1",
    port:3307,
    database:"ignacio",
    connectionLimit: 5
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static('views')); // Static Files
app.use(express.urlencoded({extended: true}));

app.use(express.static('css'));
app.use(express.static('image'));

app.get('/', function (req, res) {
    res.render('index');
});

app.get('/word_count', function (req, res) {
    res.render('word_count', { palabras, searchedPalabras, error : null, datosDePagina });    
});

app.get('/page', function (req, res) {
    let error = null;

    const mainQuery = `
    SELECT
        wikipedia.ID, 
        wikipedia.title, 
        wikipedia.amountOfTitles,
        images.total_images,
        images.unique_words,
        SUM(referencias.amountReferences) as amountReferences,
        SUM(referencias.status) as amountActiveReferences,
        GROUP_CONCAT(DISTINCT CONCAT(differentwords.position, ': ', differentwords.total) SEPARATOR ', ') AS distinct_word
    FROM wikipedia
    JOIN differentwords ON wikipedia.ID = differentwords.id_wikipedia
    JOIN images ON wikipedia.ID = images.id_wikipedia
    JOIN referencias ON wikipedia.ID = referencias.id_wikipedia
    GROUP BY 
        wikipedia.ID, 
        wikipedia.title, 
        wikipedia.amountOfTitles,
        images.total_images,
        images.unique_words
    LIMIT 1000;
`;


    const subQuery = `
        SELECT 
            sub.ID_Wikipedia,
            GROUP_CONCAT(CONCAT(sub.word, ': ', sub.repetitions) SEPARATOR ', ') AS top_words
        FROM (
            SELECT 
                c.ID_Wikipedia,
                c.word, 
                c.repetitions,
                ROW_NUMBER() OVER (PARTITION BY c.ID_Wikipedia ORDER BY c.repetitions DESC) AS rn
            FROM 
                commonwords c
        ) AS sub
        WHERE sub.rn <= 5
        GROUP BY
            sub.ID_Wikipedia
        LIMIT 1000;
    `;

    const subQuery2 = `
        SELECT 
            cite.ID_WIKIPEDIA,
            GROUP_CONCAT(CONCAT(cite.link, ': ', cite.total) SEPARATOR ', ') AS reference_text
        FROM (
            SELECT 
                c.ID_Wikipedia,
                c.total, 
                c.link
            FROM 
                cites c
        ) AS cite
        GROUP BY cite.ID_WIKIPEDIA
        LIMIT 1000;
    `;

    pool.getConnection()
    .then(conn => {
        return Promise.all([
            conn.query(mainQuery),
            conn.query(subQuery),
            conn.query(subQuery2)
        ]);
    })
    .then(([mainResults, subResults, subSubResults]) => {
        datosDeWebsite = mainResults; 
        topPalabras = subResults
        topReferences = subSubResults
        res.render('page_stats', { pages, searchedPages, error, datosDeWebsite, topPalabras, topReferences});
    })
    .catch(err => {
        error = 'No se pudo cargar los datos de DB';
        console.error(err);
        res.render('page_stats', { pages, searchedPages, error, datosDeWebsite, topPalabras : [], topReferences : [] });
    });
});



app.post('/addWordToList', function(req, res){
    newWord = req.body.newWord;

    // Clean newWord from symbols
    newWord = newWord.replace(/[^a-zA-Z ]/g, "");

    // Remove spaces from newWord
    newWord = newWord.replace(/\s/g, '');

    // Convert newWord to lowercase
    newWord = newWord.toLowerCase();

    // Check if newWord is in the list
    if(palabras.includes(newWord)){
        res.render('word_count', {palabras, searchedPalabras, error : "La palabra ya existe en la lista", datosDePagina});
        return;
    }

    palabras.push(newWord);
    res.redirect('/word_count');
});

app.get('/removeWord/:word', function(req, res){
    let word = req.params.word;
    // remove word form the list
    palabras = palabras.filter(function(value, index, arr){ 
        return value != word;
    });

    res.redirect('/word_count');
});

app.post('/addPageToList', function(req, res){
    newWord = req.body.pageLink;

    pages.length = 0;

    pages.push(newWord);
    res.render('page_stats', { pages, searchedPages, error, datosDeWebsite, topPalabras, topReferences});
});

app.get('/removePage', function(req, res){
    pages.length = 0;

    res.redirect('/page');
});

app.get('/searchWords', function(req, res){
    searchedPalabras = palabras.slice();
    
    datosDePagina = []
    let error = null

    pool.getConnection()
    .then(conn => {
        // Map each palabra to a promise representing its query
        let promises = searchedPalabras.map(palabra => {
            // Using parameterized query for safety
            let query = `
            SELECT 
                commonwords.id_wikipedia, 
                commonwords.word, 
                commonwords.repetitions, 
                (commonwords.inTitle / differentwords.total * 100) AS title_ratio, 
                wikipedia.title, 
                percentagewords.percentage,
                GROUP_CONCAT(CONCAT(tagpercentage.tag, ': ', tagpercentage.percentage) SEPARATOR ', ') AS tags_and_percentages
                    FROM commonwords 
                    JOIN wikipedia ON commonwords.id_wikipedia = wikipedia.ID 
                    JOIN tagpercentage ON commonwords.ID = tagpercentage.ID_commonword
                    JOIN percentagewords ON commonwords.ID = percentagewords.ID_commonword
                    JOIN differentwords ON wikipedia.ID = differentwords.id_wikipedia AND differentwords.position = 'title'
                    WHERE commonwords.word = ?
                    GROUP BY commonwords.id_wikipedia, commonwords.word, commonwords.repetitions, commonwords.inTitle, wikipedia.title, title_ratio
                `;
                return conn.query(query, [palabra]);
        });

        // Execute all queries simultaneously and wait for all of them to complete
        return Promise.all(promises);
    })
    .then(results => {
        // Flatten the array of arrays to a single array
        datosDePagina = results.flat();
        res.render('word_count', { palabras, searchedPalabras, error, datosDePagina });
    })
    .catch(err => {
        error = 'No se pudo cargar los datos de DB';
        console.error(err);
        res.render('word_count', { palabras, searchedPalabras, error, datosDePagina });
    });

});

app.get('/clearWords', function(req, res){
 
    datosDePagina = []
    searchedPalabras = []

    res.render('word_count', { palabras, searchedPalabras, error : null, datosDePagina })
});

app.get('/search_selected_pages', function(req, res){
    searchedPages = pages.slice();
    res.redirect('/page');
});

app.get('/search_all_pages', function(req, res){
    searchedPages = []; //  Implementar
    res.redirect('/page');
});

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
