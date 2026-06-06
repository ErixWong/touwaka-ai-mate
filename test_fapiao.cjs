const { execute } = require('./data/skills/fapiao/index.js');

async function test() {
    try {
        const result = await execute('extract', { path: 'data/attachments/2026/05/29/mpqi6812cdr6k9g78vy8.pdf' });
        console.log(JSON.stringify(result, null, 2));
    } catch (e) {
        console.error('Error:', e.message);
    }
}

test();