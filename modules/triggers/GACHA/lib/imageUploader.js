const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = 'mrsnakke';
const GITHUB_REPO = 'gachaIMG';
const GITHUB_BRANCH = 'main';

async function uploadImageToGitHub(filename, imageBuffer, rarity) {
    const pathInRepo = `img/characters/${rarity}/${filename}`;
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${pathInRepo}`;
    const content = imageBuffer.toString('base64');

    let sha = null;
    const getRes = await fetch(url, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
    });
    if (getRes.ok) {
        const existing = await getRes.json();
        sha = existing.sha;
    }

    const method = sha ? 'PUT' : 'PUT';
    const res = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            'Content-Type': 'application/json',
            Accept: 'application/vnd.github.v3+json'
        },
        body: JSON.stringify({
            message: sha ? `Update ${pathInRepo}` : `Add ${pathInRepo}`,
            content,
            branch: GITHUB_BRANCH,
            sha
        })
    });

    if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`GitHub upload failed: ${res.status} - ${errBody}`);
    }

    const data = await res.json();
    return data.content.download_url;
}

module.exports = { uploadImageToGitHub };
