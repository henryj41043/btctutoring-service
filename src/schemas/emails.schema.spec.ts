import { EmailsSchema } from './emails.schema';

describe('EmailsSchema', () => {
  // dynamoose drops attributes the schema does not know, so a field the
  // parser Lambda writes is invisible to the app until it is declared here.
  it('declares the conversation fields the parser writes', () => {
    expect(EmailsSchema.attributes()).toEqual(
      expect.arrayContaining([
        'rejected_reason',
        'is_thread',
        'message_count',
        'participants',
        'participants.0',
        'participants.0.email',
        'participants.0.name',
      ]),
    );
  });
});
