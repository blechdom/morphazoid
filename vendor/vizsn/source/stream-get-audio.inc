	// Stream the same native hold/50-transition-tick sequence. The rate control
	// is a host extension; streaming removes the old 2048-sample phone-buffer
	// overflow at slow rates without changing native samples or timing rules.
	unsigned int VizsnInstance::getAudio(float *aBuffer, unsigned int aSamplesToRead, unsigned int /*aBufferSize*/)
	{
		unsigned int idx = 0;
		while (idx < aSamplesToRead)
		{
			if (!mPhoneActive)
			{
				setphone(&mBank0, *mS, mPitch);
				if (*mS == P_END) break;
				setphone(&mBank1, mS[1], mPitch);
				slidePrepare(50);
				mNper = 0;
				mNextPlosive = plosive(mS[1]);
				mHoldRemaining = floor((plosive(*mS) ? 100.0f : 300.0f) / mRate);
				mTickLength = floor((mNextPlosive ? 3.0f : 10.0f) / mRate);
				mTickRemaining = mTickLength;
				mTicksRemaining = 50;
				mPhoneActive = true;
			}
			if (mHoldRemaining > 0)
			{
				aBuffer[idx++] = genwave();
				mHoldRemaining -= 1;
				continue;
			}
			if (mTicksRemaining)
			{
				if (mTickRemaining > 0)
				{
					aBuffer[idx++] = genwave();
					mTickRemaining -= 1;
					continue;
				}
				if (!mNextPlosive) slideTick();
				mTicksRemaining--;
				mTickRemaining = mTickLength;
				continue;
			}
			mS++;
			memcpy(&mBank0, &mBank1, sizeof(VizsnBank));
			mPhoneActive = false;
		}
		return idx;
	}
