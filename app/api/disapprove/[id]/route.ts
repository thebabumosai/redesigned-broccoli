import { NextRequest, NextResponse } from 'next/server'
import { createClient } from 'redis'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { verify } from 'jsonwebtoken'

const redisClient = createClient({
    url: process.env.REDIS_URL,
})

redisClient.on('error', (err) => console.log('Redis Client Error', err))

const s3Client = new S3Client({
    region: process.env.AWS_REGION!,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
})

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        await redisClient.connect()
        //get the token from the query
        const token = params.id
        //verify the token
        //@ts-ignore
        const decoded = verify(token, process.env.JWT_SECRET)
        const submissionId = decoded.submissionId
        const submissionData = await redisClient.get(`submission:${submissionId}`)

        if (!submissionData) {
            return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
        }

        const submission = JSON.parse(submissionData)

        // Delete from S3
        const deleteParams = {
            Bucket: process.env.S3_BUCKET_NAME!,
            Key: submission.photoUrl.split('/').pop(),
        }

        await s3Client.send(new DeleteObjectCommand(deleteParams))

        // Remove from Redis
        await redisClient.del(`submission:${submissionId}`)
        await redisClient.lRem('unapproved_submissions', 0, submissionId)

        //edit the webhook message in discord
        const discordMessageId = submission.discordMessageId
        const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL
        console.log('Discord message id:', `${discordWebhookUrl}/messages/${discordMessageId}`)

        //get the message
        const discordWebhookMessageResponse = await fetch(`${discordWebhookUrl}/messages/${discordMessageId}`, {
            headers: {
                accept: 'application/json',
            },
        })
        const discordWebhookMessage = await discordWebhookMessageResponse.json()
        console.log('Discord webhook message:', discordWebhookMessage)

        //remove the fields from the embed
        delete discordWebhookMessage.embeds[0].fields
        //remove the 'will expire in 7 days' from the content and add 'Approved' to the content
        discordWebhookMessage.content = discordWebhookMessage.content.replace(/Request expires in 7 days/, '[REJECTED]')

        //edit the message
        //send PATCH request to discord
        const discordWebhookMessageEditResponse = await fetch(`${discordWebhookUrl}/messages/${discordMessageId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(discordWebhookMessage),
        })
        // const discordWebhookMessageEdit = await discordWebhookMessageEditResponse.json()
        // console.log('Discord webhook message edit response:', discordWebhookMessageEdit)

        await redisClient.disconnect()

        return NextResponse.json({ message: 'Submission disapproved and deleted successfully' })
    } catch (error) {
        console.error('Error disapproving submission:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}