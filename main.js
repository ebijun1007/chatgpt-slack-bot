import { WebClient } from '@slack/web-api';
import { ChatCompletionRequestMessageRoleEnum, Configuration, OpenAIApi } from "openai";

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const openaiConfig = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openaiClient = new OpenAIApi(openaiConfig);

const CHAT_GPT_SYSTEM_PROMPT = `
・情報が不十分な場合、返答せずに私に聞き返してください
・まとめや結論は指示がない限り書かないでください
・重要ではないことも省略せずに書いてください
`

export const handler = async (event, context) => {
    if (event.headers['x-slack-retry-num']) {
        return { statusCode: 200, body: JSON.stringify({ message: "No need to resend" }) };
    }

    const body = JSON.parse(event.body);
    const text = body.event.text.replace(/<@.*>/g, "");
    const thread_ts = body.event.thread_ts || body.event.ts;
    const channel = body.event.channel;  
    const messages = await getThreadMessages(channel, thread_ts);
    
    // tokenの制限を回避するため、最初のメッセージを除いた最大12件のメッセージで区切る
    const prevMessages = messages.slice(-12).map(m => {
      const role = m.bot_id ? ChatCompletionRequestMessageRoleEnum.Assistant : ChatCompletionRequestMessageRoleEnum.User
      return {role: role, content: m.text}
    });
    
    const openaiResponse = await createCompletion(text, prevMessages.slice(0, prevMessages.length-1));
    await postMessage(body.event.channel, openaiResponse, thread_ts);

    return { statusCode: 200, body: JSON.stringify({ message: openaiResponse }) };
};

async function createCompletion(text, prevMessages) {
  console.log(prevMessages);
    try {
        const response = await openaiClient.createChatCompletion({
          model: 'gpt-3.5-turbo',
          messages: [
            {role: ChatCompletionRequestMessageRoleEnum.System, content: CHAT_GPT_SYSTEM_PROMPT},
            ...prevMessages,
            {role: ChatCompletionRequestMessageRoleEnum.User, content: text}
          ],
        });
        console.log([
            {role: ChatCompletionRequestMessageRoleEnum.System, content: CHAT_GPT_SYSTEM_PROMPT},
            ...prevMessages,
            {role: ChatCompletionRequestMessageRoleEnum.User, content: text}
          ]);
        return response.data.choices[0].message?.content;
    } catch(err) {
        console.error(err);
    }
}

async function postMessage(channel, text, thread_ts) {
    try {
        let payload = {
            channel: channel,
            text: text,
            as_user: true,
            thread_ts: thread_ts
        };
        const response = await slackClient.chat.postMessage(payload);
    } catch(err) {
        console.error(err);
    }
}

/**
 * 投稿メッセージIDから、その投稿に含まれるスレッドメッセージを取得する関数
 */
async function getThreadMessages(channel, threadTs) {
  try {
    const result = await slackClient.conversations.replies({ channel: channel, ts: threadTs });
    return result.messages.sort((a, b) => a.ts - b.ts);
  } catch (error) {
    console.error('Error getting thread messages: ', error);
    return [];
  }
}

