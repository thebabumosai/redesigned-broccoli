import { NextRequest, NextResponse } from 'next/server'
import { createClient } from 'redis'
import { verify } from 'jsonwebtoken'

const redisClient = createClient({
    url: process.env.REDIS_URL,
})

redisClient.on('error', (err) => console.log('Redis Client Error', err))

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
        submission.status = 'approved'

        await redisClient.set(`submission:${submissionId}`, JSON.stringify(submission))
        await redisClient.lRem('unapproved_submissions', 0, submissionId)
        await redisClient.sAdd(`pandal:${submission.pandalId}:photos`, submissionId)

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
        discordWebhookMessage.content = discordWebhookMessage.content.replace(/Request expires in 7 days/, '[APPROVED]')
    
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

        return NextResponse.json({ message: 'Submission approved successfully' })
    } catch (error) {
        console.error('Error approving submission:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}