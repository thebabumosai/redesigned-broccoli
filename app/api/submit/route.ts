import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { createClient } from 'redis'
import { v4 as uuidv4 } from 'uuid'
import { sign } from 'jsonwebtoken'
import axios from 'axios';
import sharp from 'sharp';
import { createCanvas } from 'canvas';

/**
 * Adds a watermark to the bottom-left corner of the image.
 * @param imageBuffer - Buffer of the original image.
 * @param nickname - Nickname to include in the watermark.
 * @param id - ID to include below the nickname in the watermark.
 * @returns Modified image buffer with the watermark in WebP format.
 */
async function addWatermark(imageBuffer: Buffer, nickname: string, id: string): Promise<Buffer> {
    try {
        // Get the metadata of the image to determine dimensions
        const imageMetadata = await sharp(imageBuffer).metadata();

        const width = imageMetadata.width ?? 800; // Default width if not found
        const height = imageMetadata.height ?? 600; // Default height if not found

        // Create a canvas to draw the watermark text
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');

        // Set the font size relative to the image dimensions
        const fontSize = Math.round(Math.min(width, height) * 0.03);
        context.font = `${fontSize}px sans-serif`;

        // Set text color and alignment
        context.fillStyle = 'rgba(255, 255, 255, 0.8)'; // White color with some transparency
        context.textAlign = 'left';

        // Draw the watermark text at the bottom-left corner
        const padding = 20; // Padding from the edges
        context.fillText("Image Courtesy: "+nickname, padding, height - padding - fontSize);
        context.fillText(id, padding, height - padding);

        // Render the canvas as a PNG buffer
        const watermarkBuffer = canvas.toBuffer('image/png');

        // Combine the original image with the watermark using sharp
        const modifiedImageBuffer = await sharp(imageBuffer)
            .composite([{ input: watermarkBuffer, gravity: 'southwest' }]) // Position the watermark at southwest (bottom-left)
            .toFormat('webp') // Convert to WebP format
            .toBuffer();

        return modifiedImageBuffer;
    } catch (error) {
        console.error('Error adding watermark:', error);
        throw new Error('Failed to add watermark to the image.');
    }
}


const s3Client = new S3Client({
    region: process.env.AWS_REGION!,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
})




export async function POST(request: NextRequest) {
    try {
        const redisClient = createClient({
            url: process.env.REDIS_URL,
        })
        redisClient.on('error', (err) => console.log('Redis Client Error', err))

        await redisClient.connect()

        const formData = await request.formData()
        const photo = formData.get('photo') as File
        const username = formData.get('username') as string
        const email = formData.get('email') as string
        const location = formData.get('location') as string
        const pandalId = formData.get('pandalId') as string
        const pandalName = formData.get('pandalName') as string
        const coordinates = JSON.parse(formData.get('coordinates') as string)
        const imageType = formData.get('imageType') as string
        const redditUsername = formData.get('redditUsername') as string

        const submissionId = uuidv4()
        const fileName = `${submissionId}`

        //check if file is an image
        if (!photo.type.startsWith('image/')) {
            return NextResponse.json({ error: 'Invalid file type' }, { status: 400 })
        }
        //check if file is too large
        if (photo.size > 6 * 1024 * 1024) {
            return NextResponse.json({ error: 'File is too large' }, { status: 400 })
        }

        const modifiedImageBuffer = await addWatermark(Buffer.from(await photo.arrayBuffer()), username, `ID: ${submissionId}`);

        // Upload to S3
        const uploadParams = {
            Bucket: process.env.S3_BUCKET_NAME!,
            Key: fileName,
            Body: modifiedImageBuffer,
            ContentType: 'image/webp',
            //make it public
            ACL: 'public-read',
            //cache for 1 week
            CacheControl: 'max-age=604800',
        }
        //@ts-ignore
        await s3Client.send(new PutObjectCommand(uploadParams))
        //store original image in s3
        const originalUploadParams = {
            Bucket: process.env.S3_BUCKET_NAME!,
            Key: `original/${fileName}`,
            Body: Buffer.from(await photo.arrayBuffer()),
            ContentType: photo.type,
            //make it public
            ACL: 'public-read',
            //cache for 1 week
            CacheControl: 'max-age=604800',
        }
        //@ts-ignore
        await s3Client.send(new PutObjectCommand(originalUploadParams))

        // Store data in Redis
        const submissionData = {
            id: submissionId,
            username,
            email,
            location,
            pandalId,
            pandalName,
            coordinates,
            imageType,
            redditUsername,
            photoUrl: `https://${process.env.S3_BUCKET_NAME}.s3.ap-south-1.amazonaws.com/${fileName}`,
            status: 'unapproved',
            discordMessageId: '',
        }

        await redisClient.set(`submission:${submissionId}`, JSON.stringify(submissionData))
        await redisClient.lPush('unapproved_submissions', submissionId)
        
        // Sign JWT
        const jwt = sign({ submissionId }, process.env.JWT_SECRET!, {
            expiresIn: '7d',
        })


        // Send Discord webhook
        const webhookUrl = process.env.DISCORD_WEBHOOK_URL!
        const approveUrl = `${process.env.APP_URL}/api/approve/${jwt}`
        const disapproveUrl = `${process.env.APP_URL}/api/disapprove/${jwt}`

        const webhookBody = {
            content: `New submission from @${username}!\nRequest expires in 7 days`,
            embeds: [
                {
                    title: 'New Pujo Picture Submission',
                    description: `Location: ${coordinates}\nPandal: ${pandalName}\nImage Type: ${imageType}\nID: ${submissionId}\npandalId: ${pandalId}\nReddit Username: ${redditUsername}`,
                    image: {
                        url: submissionData.photoUrl,
                    },
                    fields: [
                        {
                            name: 'Approve',
                            value: `[yah](${approveUrl})`,
                            inline: true,
                        },
                        {
                            name: 'Disapprove',
                            value: `[nah](${disapproveUrl})`,
                            inline: true,
                        },
                    ],
                },
            ],
            "username": "big picture",
            "avatar_url": "https://image-forwarder.notaku.so/aHR0cHM6Ly9ub3Rpb24tdGFza3MtYzc2NWM4ZS1oaGxqM2k2ZWlxLXVlLmEucnVuLmFwcC9lbW9qaS8lRjAlOUYlQTQlOTY=",
        }
        console.log('Discord webhook body:', JSON.stringify(webhookBody))

        // const webhookreq = await fetch(webhookUrl, {
        //     method: 'POST',
        //     headers: {
        //         'Content-Type': 'application/json',
        //     },
        //     body: JSON.stringify(webhookBody),
        // })

        // const webhookres = await webhookreq.json()
        // console.log('Discord webhook response:', webhookres)
        
        // send webhook & get response (message id)
        await axios.post(webhookUrl+'?wait=true', webhookBody)
        .then(async (response) => {
            console.log('Discord webhook response:', response.data)
            //add it to the submission data
            submissionData['discordMessageId'] = response.data.id
            //store it in redis
            await redisClient.set(`submission:${submissionId}`, JSON.stringify(submissionData))
        })

        await redisClient.disconnect()

        return NextResponse.json({ submissionId })
    } catch (error) {
        console.error('Error processing submission:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
    
}