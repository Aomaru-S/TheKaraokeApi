const express = require('express');
const puppeteer = require('puppeteer');
const router = express.Router();
const mysql = require("mysql2");

const connection = mysql.createConnection({
    host: 'www.aoi-ryo.com',
    port: 42052,
    user: 'root',
    password: 'eelienole9aPaetheiraeThishal1sho',
    database: 'the_karaoke_api'
});

router.post('/', function (req, res) {
    (async callback => {
        // Init browser
        const browser = await puppeteer.launch({
            headless: false,
            args: ['--disable-web-security']
        });
        const page = (await browser.pages())[0];

        // Disable loading of CSS, image and font.
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            if (['image', 'stylesheet', 'font'].indexOf(request.resourceType()) !== -1) {
                request.abort();
            } else {
                request.continue();
            }
        });

        // Login
        await page.goto('https://www.joysound.com/utasuki/login.htm');
        const userNameFormSelector = '.usk-inform-input-ml > .usk-col2 > .jp-cmp-search-block-002 > .jp-cmp-search-block-column > input';
        const passwordFormSelector = '.usk-inform-input-nickname > .usk-col2 > .jp-cmp-search-block-002 > .jp-cmp-search-block-column > input';
        await page.type(userNameFormSelector, 'yggdrasill0430@gmail.com')
        await page.type(passwordFormSelector, 'kZBVvgb4s49EV5G')

        await Promise.all([
            page.waitForNavigation({waitUntil: ['load', 'networkidle2']}),
            await page.click('#usk-login-login-button')
        ]);

        // Song and song history scraping
        let startIndex = 0;
        let flag = true;
        let result = [];
        const sql = 'select play_date_time from the_karaoke_api.song_history order by play_date_time desc limit 1';
        let lastPlayDateTime;
        connection.query(sql, (err, rows) => {
                if (rows.length > 0) {
                    lastPlayDateTime = rows[0].play_date_time;
                }
            }
        );
        await page.on('response', async response => {
            let JsonResponse;
            if (!JsonResponse && response.url().startsWith('https://www.joysound.com/api/1.0/member/@me/karaokeHistory')) {
                response.json().then(response => {
                    if (!response.pager.isNext) {
                        flag = false;
                    }

                    const myKaraokes = response.myKaraokes;
                    for (const i in myKaraokes) {
                        const karaoke = {
                            songId: myKaraokes[i].selSong.selSongNo,
                            songName: myKaraokes[i].selSong.selSongName,
                            songRuby: myKaraokes[i].selSong.selSongNameRuby,
                            playDateTime: myKaraokes[i].playDateTime,
                            intervalKey: myKaraokes[i].key,
                            artistId: null,
                            artistName: null,
                            artistRuby: null,
                        }
                        if (karaoke.playDateTime === lastPlayDateTime) {
                            flag = false;
                            break;
                        }
                        result.push(karaoke);
                    }
                })
            }
        });

        // Artist scraping
        while (flag) {
            await page.goto('https://www.joysound.com/utasuki/mypage/history/index.htm?startIndex=' + startIndex + '&orderBy=0&sortOrder=desc');
            startIndex += 20;
            await page.waitForTimeout(500);
        }

        let i = 0;
        await page.on('response', async response => {
            let JsonResponse;
            if (!JsonResponse && response.url().startsWith('https://mspxy.joysound.com/Common/ArtistDetail')) {
                response.json().then(response => {
                    result[i].artistId = response.artistId;
                    result[i].artistName = response.artistName;
                    result[i].artistRuby = response.artistNameRuby;
                });
            }
        });
        for (i in result) {
            const songUrl = 'https://www.joysound.com/web/search/song/' + result[i].songId + '?idType=selSongNo';
            await page.goto(songUrl);
            await page.waitForTimeout(500);
        }
        await browser.close();

        // Insert to database
        let updateCount = 0;
        connection.beginTransaction(() => {
            for (const i in result) {
                connection.query('insert ignore into the_karaoke_api.artist value (?, ?, ?)', [
                    result[i].artistId,
                    result[i].artistName,
                    result[i].artistRuby
                ]);
                connection.query('insert ignore into the_karaoke_api.song value (?, ?, ?, ?)', [
                    result[i].songId,
                    result[i].songName,
                    result[i].songRuby,
                    result[i].artistId
                ]);
                connection.query('insert ignore into the_karaoke_api.song_history value(?, ?, ?)', [
                    result[i].playDateTime,
                    result[i].songId,
                    parseInt(result[i].intervalKey)
                ]);
                updateCount++;
            }
            connection.commit();
            res.send(updateCount + ' updated.');
        });
    })();
});

router.get("/", function (req, res) {
    const sql = 'select song.song_id, song_name, song.artist_id, artist_name, interval_key, play_date_time from the_karaoke_api.song join the_karaoke_api.artist on song.artist_id = artist.artist_id join the_karaoke_api.song_history on song.song_id = song_history.song_id order by play_date_time desc;';
    connection.query(sql, [], function (err, result) {
        res.send(result);
    });
});

router.get("/artist", function (req, res) {
    const sql = 'select song.artist_id, artist_name, artist_ruby, count(song_history.song_id) as count\n' +
        'from song_history\n' +
        '         join song on song_history.song_id = song.song_id\n' +
        '         join artist on song.artist_id = artist.artist_id\n' +
        'group by song.artist_id;';
    connection.query(sql, [], function (err, result) {
        res.send(result);
    });
});

router.get("/song", function (req, res) {
    const sql = 'select song_history.song_id, song_name, song_ruby, artist.artist_id, artist_name, count(song.song_id)\n' +
        'from the_karaoke_api.song\n' +
        '         join the_karaoke_api.artist on song.artist_id = artist.artist_id\n' +
        '         join the_karaoke_api.song_history on song.song_id = song_history.song_id\n' +
        'group by song_history.song_id;';
    connection.query(sql, [], function (err, result) {
        res.send(result);
    });
});

router.post('/analysis_score', function (req, res) {
    (async callback => {
        // Init browser
        const browser = await puppeteer.launch({
            headless: false,
            args: ['--disable-web-security']
        });
        const page = (await browser.pages())[0];

        // Disable loading of CSS, image and font.
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            if (['image', 'stylesheet', 'font'].indexOf(request.resourceType()) !== -1) {
                request.abort();
            } else {
                request.continue();
            }
        });

        // Login
        await page.goto('https://www.joysound.com/utasuki/login.htm');
        const userNameFormSelector = '.usk-inform-input-ml > .usk-col2 > .jp-cmp-search-block-002 > .jp-cmp-search-block-column > input';
        const passwordFormSelector = '.usk-inform-input-nickname > .usk-col2 > .jp-cmp-search-block-002 > .jp-cmp-search-block-column > input';
        await page.type(userNameFormSelector, 'yggdrasill0430@gmail.com')
        await page.type(passwordFormSelector, 'kZBVvgb4s49EV5G')

        await Promise.all([
            page.waitForNavigation({waitUntil: ['load', 'networkidle2']}),
            await page.click('#usk-login-login-button')
        ]);

        // List of analysis ids scraping
        let startIndex = 0;
        let flag = true;
        const sql = 'select analysis_date_time from the_karaoke_api.analysis_score order by analysis_date_time desc limit 1';
        let lastAnalysisDateTime;
        connection.query(sql, (err, rows) => {
                if (rows.length > 0) {
                    lastAnalysisDateTime = rows[0].analysis_date_time;
                }
            }
        );
        const analysisMap = new Map();
        await page.on('response', async response => {
            let JsonResponse;
            if (!JsonResponse && response.url().startsWith('https://www.joysound.com/api/1.0/member/@me/score/autoAnalyses')) {
                response.json().then(response => {
                    if (!response.pager.isNext) {
                        flag = false;
                    }

                    const analystScoreResults = response.autoAnalystScoreResults;
                    for (const i in analystScoreResults) {
                        if (analystScoreResults[i].playDate === lastAnalysisDateTime) {
                            flag = false;
                            break;
                        }
                        analysisMap.set(analystScoreResults[i].analysisId, {
                            analysisDateTime: analystScoreResults[i].playDate,
                            songId: analystScoreResults[i].selSongNo,
                            intervalScore: null,
                            stableScore: null,
                            longToneScore: null,
                            inflectionScore: null,
                            technicScore: null,
                            kobushiCount: null,
                            shakuriCount: null,
                            vibratoCount: null,
                            vibratoSpeed: null,
                            vibratoDepth: null,
                            vibratoType: null
                        });
                    }
                });
            }
        });

        while (flag) {
            await page.goto('https://www.joysound.com/utasuki/mypage/analysis/index.htm?startIndex=' + startIndex + '&orderBy=0&sortOrder=desc');
            startIndex += 20;
            await page.waitForTimeout(500);
        }

        await page.on('response', async response => {
            let JsonResponse;
            if (!JsonResponse && response.url().startsWith('https://www.joysound.com/api/1.0/member/@me/score/autoAnalysis/')) {
                response.json().then(response => {
                    analysisMap.get(response.autoAnalystScoreResult.analysisId).vibratoType = response.autoAnalystScoreResult.vbrtType;
                });
            }
        });

        for (const [key, value] of analysisMap) {
            await page.goto('https://www.joysound.com/utasuki/mypage/analysis/autodetail.htm?analysisId=' + key, {waitUntil: 'networkidle0'});

            const intervalIntegerEle = await page.$$('#analysis-result-area > div:nth-child(1) > ul > li.usk-a-01.score-theme > p > span.usk-flr > em > strong');
            const intervalInteger = await (await intervalIntegerEle[0].getProperty('textContent')).jsonValue();
            const intervalDoubleEle = await page.$$('#analysis-result-area > div:nth-child(1) > ul > li.usk-a-01.score-theme > p > span.usk-flr > em > span');
            const intervalDouble = await (await intervalDoubleEle[0].getProperty('textContent')).jsonValue();
            const stableIntegerEle = await page.$$('#analysis-result-area > div:nth-child(1) > ul > li.usk-a-02.score-stable > p > span.usk-flr > em > strong');
            const stableInteger = await (await stableIntegerEle[0].getProperty('textContent')).jsonValue();
            const stableDoubleEle = await page.$$('#analysis-result-area > div:nth-child(1) > ul > li.usk-a-02.score-stable > p > span.usk-flr > em > span');
            const stableDouble = await (await stableDoubleEle[0].getProperty('textContent')).jsonValue();
            const longToneIntegerEle = await page.$$('#analysis-result-area > div:nth-child(1) > ul > li.usk-a-03.score-long-tone > p > span.usk-flr > em > strong');
            const longToneInteger = await (await longToneIntegerEle[0].getProperty('textContent')).jsonValue();
            const longToneDoubleEle = await page.$$('#analysis-result-area > div:nth-child(1) > ul > li.usk-a-03.score-long-tone > p > span.usk-flr > em > span');
            const longToneDouble = await (await longToneDoubleEle[0].getProperty('textContent')).jsonValue();
            const inflectionIntegerEle = await page.$$('#analysis-result-area > div:nth-child(1) > ul > li.usk-a-04.score-yokuyo > p > span.usk-flr > em > strong');
            const inflectionInteger = await (await inflectionIntegerEle[0].getProperty('textContent')).jsonValue();
            const inflectionDoubleEle = await page.$$('#analysis-result-area > div:nth-child(1) > ul > li.usk-a-04.score-yokuyo > p > span.usk-flr > em > span');
            const inflectionDouble = await (await inflectionDoubleEle[0].getProperty('textContent')).jsonValue();
            const technicScoreIntegerEle = await page.$$('#analysis-result-area > div:nth-child(1) > ul > li.usk-a-05.score-technique > p > span.usk-flr > em > strong');
            const technicScoreInteger = await (await technicScoreIntegerEle[0].getProperty('textContent')).jsonValue();
            const technicScoreDoubleEle = await page.$$('#analysis-result-area > div:nth-child(1) > ul > li.usk-a-05.score-technique > p > span.usk-flr > em > span');
            const technicScoreDouble = await (await technicScoreDoubleEle[0].getProperty('textContent')).jsonValue();

            const kobushiCountEle = await page.$$('#analysis-result-area > div:nth-child(2) > ul > li.usk-a-kobushi-count > span.usk-flr > strong');
            const kobushiCount = await (await kobushiCountEle[0].getProperty('textContent')).jsonValue();
            const shakuriCountEle = await page.$$('#analysis-result-area > div:nth-child(2) > ul > li.usk-a-shakuri-count > span.usk-flr > strong');
            const shakuriCount = await (await shakuriCountEle[0].getProperty('textContent')).jsonValue();
            const vibratoCountEle = await page.$$('#analysis-result-area > div:nth-child(2) > ul > li.usk-a-vib-count > span.usk-flr > strong');
            const vibratoCount = await (await vibratoCountEle[0].getProperty('textContent')).jsonValue();

            const vibratoSpeedEle = await page.$$('#vibrato-earliness-text');
            let vibratoSpeed;
            switch (await (await vibratoSpeedEle[0].getProperty('textContent')).jsonValue()) {
                case '早い':
                    vibratoSpeed = 0;
                    break;
                case '普通':
                    vibratoSpeed = 1;
                    break;
                case '遅い':
                    vibratoSpeed = 2;
                    break;
            }

            const vibratoDepthEle = await page.$$('#vibrato-depth-text');
            let vibratoDepth;
            switch (await (await vibratoDepthEle[0].getProperty('textContent')).jsonValue()) {
                case '浅い':
                    vibratoDepth = 0;
                    break;
                case '普通':
                    vibratoDepth = 1;
                    break;
                case '深い':
                    vibratoDepth = 2;
                    break;
            }

            value.intervalScore = parseFloat(intervalInteger + intervalDouble);
            value.stableScore = parseFloat(stableInteger + stableDouble);
            value.longToneScore = parseFloat(longToneInteger + longToneDouble);
            value.inflectionScore = parseFloat(inflectionInteger + inflectionDouble);
            value.technicScore = parseFloat(technicScoreInteger + technicScoreDouble);

            value.kobushiCount = parseInt(kobushiCount);
            value.shakuriCount = parseInt(shakuriCount);
            value.vibratoCount = parseInt(vibratoCount);

            value.vibratoSpeed = vibratoSpeed;
            value.vibratoDepth = vibratoDepth;

            await page.waitForTimeout(500);
        }
        await browser.close();

        // Insert to database
        let updateCount = 0;
        connection.beginTransaction(() => {
            for (const [k, v] of analysisMap) {
                const sql = 'insert into the_karaoke_api.analysis_score value (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
                connection.query(sql, [
                    k,
                    v.analysisDateTime,
                    v.songId,
                    v.intervalScore,
                    v.stableScore,
                    v.longToneScore,
                    v.intervalScore,
                    v.technicScore,
                    v.kobushiCount,
                    v.shakuriCount,
                    v.vibratoCount,
                    v.vibratoSpeed,
                    v.vibratoCount,
                    v.vibratoType
                ]);
                updateCount++;
            }

            connection.commit();
            res.send(updateCount + ' updated.');
        });
    })();
});

module.exports = router;