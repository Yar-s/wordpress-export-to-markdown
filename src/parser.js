const fs = require('fs');
const luxon = require('luxon');
const xml2js = require('xml2js');

const shared = require('./shared');
const translator = require('./translator');

async function parseFilePromise(config) {
	console.log('\nParsing...');
	const content = await fs.promises.readFile(config.input, 'utf8');
	const data = await xml2js.parseStringPromise(content, {
		trim: true,
		tagNameProcessors: [xml2js.processors.stripPrefix]
	});

	const posts = collectPosts(data, config);

	const images = [];
	if (config.saveAttachedImages) {
		images.push(...collectAttachedImages(data));
	}
	if (config.saveScrapedImages) {
		images.push(...collectScrapedImages(data, config));
	}

	mergeImagesIntoPosts(images, posts);

	return posts;
}

function getItemsOfTypes(data, ...types) {
	return data.rss.channel[0].item.filter(item => types.includes(item.post_type[0]));
}

function collectPosts(data, config) {
	// this is passed into getPostContent() for the markdown conversion
	const turndownService = translator.initTurndownService();

	const types = config.postTypes.split(',');
	const posts = getItemsOfTypes(data, ...types)
		.filter(post => post.status[0] !== 'trash' && post.status[0] !== 'draft')
		.map(post => ({
			// meta data isn't written to file, but is used to help with other things
			meta: {
				id: getPostId(post),
				slug: getPostSlug(post),
				coverImageId: getPostCoverImageId(post),
				imageUrls: [],
				type: getPostType(post),
			},
			frontmatter: {
				title: getPostTitle(post),
				date: getPostDate(post),
				slug: getPostSlug(post),
				link: getLink(post),
				creator: getCreator(post),
				description: getDescription(post),
				commentStatus: getCommentStatus(post),
				pingStatus: getPingStatus(post),
				isSticky: isSticky(post),
				categories: getCategories(post),
				tags: getTags(post),
			},
			content: translator.getPostContent(post, turndownService, config)
		}));

	console.log(posts.length + ' posts found.');
	return posts;
}

function getPostId(post) {
	return post.post_id[0];
}

function getPostSlug(post) {
	return post.post_name[0];
}

function getPostCoverImageId(post) {
	if (post.postmeta === undefined) {
		return undefined;
	}

	const postmeta = post.postmeta.find(postmeta => postmeta.meta_key[0] === '_thumbnail_id');
	const id = postmeta ? postmeta.meta_value[0] : undefined;
	return id;
}

function getPostType(post) {
	return post.post_type[0];
}

function getPostTitle(post) {
	return post.title[0];
}

function getPostDate(post) {
	return luxon.DateTime.fromRFC2822(post.pubDate[0], { zone: 'utc' }).toISODate();
}

function getLink(post) {
	return post.link[0];
}

function getCreator(post) {
	return post.creator[0];
}

function getDescription(post) {
	return post.description[0];
}

function getCommentStatus(post) {
	return post['comment_status'][0];
}

function getPingStatus(post) {
	return post['ping_status'][0];
}

function isSticky(post) {
	return post['is_sticky'][0];
}

function getCategories(post) {
	if (!post.category) {
		return [];
	}
	return post.category.filter(c => c['$'].domain === 'category').map(c => c['_']);
}

function getTags(post) {
	if (!post.tags) {
		return [];
	}
	return post.category.filter(c => c['$'].domain === 'post_tag').map(c => c['_']);
}

function collectAttachedImages(data) {
	const images = getItemsOfTypes(data, 'attachment')
		// filter to certain image file types
		.filter(attachment => (/\.(gif|jpe?g|png)$/i).test(attachment.attachment_url[0]))
		.map(attachment => ({
			id: attachment.post_id[0],
			postId: attachment.post_parent[0],
			url: attachment.attachment_url[0]
		}));

	console.log(images.length + ' attached images found.');
	return images;
}

function collectScrapedImages(data, config) {
	const images = [];
	const types = config.postTypes.split(',');
	getItemsOfTypes(data, ...types).forEach(post => {
		const postId = post.post_id[0];
		const postContent = post.encoded[0];
		const postLink = post.link[0];

		const matches = [...postContent.matchAll(/<img[^>]*src="(.+?\.(?:gif|jpe?g|png))"[^>]*>/gi)];
		matches.forEach(match => {
			// base the matched image URL relative to the post URL
			const url = new URL(match[1], postLink).href;

			images.push({
				id: -1,
				postId: postId,
				url: url
			});
		});
	});

	console.log(images.length + ' images scraped from post body content.');
	return images;
}

function mergeImagesIntoPosts(images, posts) {
	// create lookup table for quicker traversal
	const postsLookup = posts.reduce((lookup, post) => {
		lookup[post.meta.id] = post;
		return lookup;
	}, {});

	images.forEach(image => {
		const post = postsLookup[image.postId];
		if (post) {
			if (image.id === post.meta.coverImageId) {
				// save cover image filename to frontmatter
				post.frontmatter.coverImage = shared.getFilenameFromUrl(image.url);
			}
			
			// save (unique) full image URLs for downloading later
			if (!post.meta.imageUrls.includes(image.url)) {
				post.meta.imageUrls.push(image.url);
			}
		}
	});
}

exports.parseFilePromise = parseFilePromise;
